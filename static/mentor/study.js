import { state, elements, setText, setStatusTone } from "./workspace.js?v=20260910-cleanup";
import { fetchJson, postJson } from "./api.js?v=20260910-cleanup";
const studyStatusLabels = {
  started: "Started",
  understood: "Problem understood",
  brute_force: "Brute force ready",
  solved: "Working solution",
  optimized: "Optimized solution",
  mastered: "Can explain it"
};

function setStudyBusy(isBusy) {
  state.studySaving = isBusy;
  [elements.studyStatus, elements.studyConfidence, elements.studyMistakeCategory, elements.studyReflection].forEach((control) => {
    if (control) {
      control.disabled = isBusy || !state.problem;
    }
  });
  if (elements.saveStudyBtn) {
    elements.saveStudyBtn.disabled = isBusy || !state.problem;
    setText(elements.saveStudyBtn, isBusy ? "Saving..." : "Save learning review");
  }
  if (elements.reviewQueue) {
    elements.reviewQueue.querySelectorAll("button").forEach((button) => {
      button.disabled = isBusy;
    });
  }
}

function formatReviewDate(value, due) {
  if (!value) {
    return "Reach a working solution to start spaced revision.";
  }
  if (due) {
    return "Review due now";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Review scheduled";
  }
  return `Next review ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}`;
}

function applyStudyRecord(record) {
  if (!elements.studyStatus) {
    return;
  }

  elements.studyStatus.value = record?.status || "started";
  elements.studyConfidence.value = String(record?.confidence || 3);
  elements.studyMistakeCategory.value = record?.mistakeCategory || "";
  elements.studyReflection.value = record?.reflection || "";
  setText(
    elements.studyNextReview,
    formatReviewDate(record?.nextReviewAt, Boolean(record?.due))
  );
  setText(
    elements.studySaveStatus,
    record?.updatedAt ? "Learning note restored for this problem." : "Add a checkpoint after your next attempt."
  );
  setStatusTone(elements.studySaveStatus, "neutral");
  setStudyBusy(false);
}

function renderReviewQueue(queue) {
  if (!elements.reviewQueue) {
    return;
  }

  elements.reviewQueue.replaceChildren();
  const entries = Array.isArray(queue) ? queue : [];
  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "review-queue__empty";
    const emptyTitle = document.createElement("strong");
    emptyTitle.textContent = "No revisions scheduled yet.";
    const emptyCopy = document.createElement("p");
    emptyCopy.textContent = "Save a solved checkpoint to add one.";
    empty.append(emptyTitle, emptyCopy);
    elements.reviewQueue.appendChild(empty);
    return;
  }

  entries.slice(0, 8).forEach((entry) => {
    const item = document.createElement("article");
    item.className = `review-queue__item${entry.due ? " review-queue__item--due" : ""}`;

    const title = document.createElement("p");
    title.className = "review-queue__title";
    title.textContent = `${entry.frontendId ? `${entry.frontendId}. ` : ""}${entry.problemTitle || entry.problemSlug}`;

    const meta = document.createElement("p");
    meta.className = "review-queue__meta";
    const checkpoint = studyStatusLabels[entry.status] || "In progress";
    meta.textContent = `${formatReviewDate(entry.nextReviewAt, Boolean(entry.due))} · ${checkpoint}`;

    const actions = document.createElement("div");
    actions.className = "review-queue__actions";

    const loadButton = document.createElement("button");
    loadButton.type = "button";
    loadButton.className = "button button--ghost button--compact";
    loadButton.dataset.studyLoadSlug = entry.problemSlug;
    loadButton.textContent = "Load problem";
    loadButton.setAttribute("aria-label", `Load ${entry.problemTitle || entry.problemSlug} for revision`);
    actions.appendChild(loadButton);

    if (entry.due) {
      const reviewedButton = document.createElement("button");
      reviewedButton.type = "button";
      reviewedButton.className = "button button--secondary button--compact";
      reviewedButton.dataset.reviewSlug = entry.problemSlug;
      reviewedButton.dataset.reviewStage = String(entry.reviewStage ?? 0);
      reviewedButton.textContent = "Reviewed today";
      reviewedButton.setAttribute("aria-label", `Mark ${entry.problemTitle || entry.problemSlug} reviewed today`);
      actions.appendChild(reviewedButton);
    }

    item.append(title, meta, actions);
    elements.reviewQueue.appendChild(item);
  });

  if (entries.length > 8) {
    const remaining = document.createElement("p");
    remaining.className = "review-queue__more";
    remaining.textContent = `${entries.length - 8} more scheduled. Finish the earliest reviews first.`;
    elements.reviewQueue.appendChild(remaining);
  }
}

export async function loadStudyData(problemSlug) {
  if (!elements.reviewQueue || !elements.studyStatus) {
    return;
  }

  const loadVersion = ++state.studyLoadVersion;
  if (problemSlug) {
    elements.studyStatus.value = "started";
    elements.studyConfidence.value = "3";
    elements.studyMistakeCategory.value = "";
    elements.studyReflection.value = "";
    setText(elements.studyNextReview, "Reach a working solution to start spaced revision.");
  }
  setText(elements.studySaveStatus, "Loading learning record...");
  setStatusTone(elements.studySaveStatus, "loading");
  setStudyBusy(true);
  setText(elements.saveStudyBtn, "Loading...");

  const query = problemSlug ? `?problem_slug=${encodeURIComponent(problemSlug)}` : "";
  try {
    const data = await fetchJson(`/api/study/${query}`);
    if (loadVersion !== state.studyLoadVersion) {
      return;
    }
    applyStudyRecord(data.record);
    renderReviewQueue(data.queue);
  } catch (error) {
    if (loadVersion !== state.studyLoadVersion) {
      return;
    }
    applyStudyRecord(null);
    renderReviewQueue([]);
    setStatusTone(elements.studySaveStatus, "error");
    setText(elements.studySaveStatus, error.name === "AbortError" ? "Learning record request timed out." : error.message);
  }
}

export async function saveStudyRecord() {
  if (!state.problem || state.studySaving) {
    setStatusTone(elements.studySaveStatus, "error");
    setText(elements.studySaveStatus, "Load a problem before saving a learning note.");
    return;
  }

  const problemSlug = state.problem.titleSlug;
  const requestVersion = state.studyLoadVersion;
  setStudyBusy(true);
  setStatusTone(elements.studySaveStatus, "loading");
  setText(elements.studySaveStatus, "Saving your checkpoint...");

  const payload = {
    action: "save",
    problemSlug,
    problemTitle: state.problem.title,
    frontendId: state.problem.questionFrontendId,
    difficulty: state.problem.difficulty,
    status: elements.studyStatus.value,
    confidence: Number(elements.studyConfidence.value),
    mistakeCategory: elements.studyMistakeCategory.value,
    reflection: elements.studyReflection.value.trim()
  };

  try {
    const data = await postJson("/api/study/", payload);
    if (requestVersion !== state.studyLoadVersion || state.problem?.titleSlug !== problemSlug) {
      return;
    }
    applyStudyRecord(data.record);
    renderReviewQueue(data.queue);
    setStatusTone(elements.studySaveStatus, "success");
    setText(elements.studySaveStatus, "Learning checkpoint saved.");
  } catch (error) {
    if (requestVersion !== state.studyLoadVersion || state.problem?.titleSlug !== problemSlug) {
      return;
    }
    setStatusTone(elements.studySaveStatus, "error");
    setText(elements.studySaveStatus, error.name === "AbortError" ? "Saving timed out. Try again." : error.message);
  } finally {
    if (requestVersion === state.studyLoadVersion && state.problem?.titleSlug === problemSlug) {
      setStudyBusy(false);
    }
  }
}

export async function markStudyReviewed(problemSlug, expectedReviewStage) {
  if (!problemSlug || state.studySaving) {
    return;
  }

  const requestVersion = state.studyLoadVersion;
  setStudyBusy(true);
  setStatusTone(elements.studySaveStatus, "loading");
  setText(elements.studySaveStatus, "Updating revision schedule...");
  try {
    const data = await postJson("/api/study/", { action: "reviewed", problemSlug, expectedReviewStage });
    if (requestVersion !== state.studyLoadVersion) {
      return;
    }
    if (state.problem?.titleSlug === problemSlug) {
      applyStudyRecord(data.record);
    }
    renderReviewQueue(data.queue);
    setStatusTone(elements.studySaveStatus, "success");
    setText(elements.studySaveStatus, "Review logged. The next revision is scheduled.");
  } catch (error) {
    if (requestVersion !== state.studyLoadVersion) {
      return;
    }
    setStatusTone(elements.studySaveStatus, "error");
    setText(elements.studySaveStatus, error.name === "AbortError" ? "Update timed out. Try again." : error.message);
  } finally {
    if (requestVersion === state.studyLoadVersion) {
      setStudyBusy(false);
    }
  }
}
