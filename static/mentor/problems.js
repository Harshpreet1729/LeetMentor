// Load a LeetCode problem and update its details, draft, and study record.
import {
  state,
  elements,
  setText,
  setHidden,
  setStatusTone,
  setBusy
} from "./workspace.js?v=20260910-readability";
import {
  renderProblemExamples,
  renderProblemConstraints,
  renderProblemPreview
} from "./rendering.js?v=20260910-readability";
import { saveDraftFor, restoreDraftFor, saveWorkspaceSnapshot } from "./drafts.js?v=20260910-readability";
import { isLeetCodeReachabilityError, fetchJson, runWithWakeRetry } from "./api.js?v=20260910-readability";
import { loadStudyData } from "./study.js?v=20260910-readability";

// Render a loaded problem and restore its own saved draft.
export function applyProblemState(problem, options = {}) {
  const previousProblem = state.problem;
  const isDifferentProblem = previousProblem?.titleSlug !== problem?.titleSlug;
  if (isDifferentProblem && (previousProblem || elements.codeInput.value)) {
    saveDraftFor(previousProblem, state.activeLanguage, elements.codeInput.value);
  }
  state.problem = problem;
  if (isDifferentProblem || options.restoreDraft) {
    restoreDraftFor(problem, state.activeLanguage, { legacyDraft: options.legacyDraft });
  }
  const tags = Array.isArray(problem.tags) ? problem.tags.filter(Boolean) : [];
  const summaryTags = tags.slice(0, 3);
  const difficulty = problem.difficulty || "Unknown";
  const hasExpandedContext = Boolean(
    (Array.isArray(problem.exampleCards) && problem.exampleCards.length) ||
    (Array.isArray(problem.examples) && problem.examples.length) ||
    (Array.isArray(problem.constraints) && problem.constraints.length)
  );

  setText(elements.problemTitle, problem.title ? `${problem.questionFrontendId}. ${problem.title}` : "Unknown problem");
  renderProblemPreview(problem);
  setText(
    elements.problemStatement,
    problem.title
      ? `Difficulty: ${difficulty}${tags.length ? ` - Topics: ${tags.join(", ")}` : ""}`
      : "Difficulty, topics, and a short summary appear here after you load a problem."
  );
  setText(
    elements.workspaceProblemMeta,
    problem.title
      ? `${problem.questionFrontendId}. ${problem.title} - ${difficulty}${summaryTags.length ? ` - ${summaryTags.join(" - ")}` : ""}`
      : "Load a problem to begin a guided practice session."
  );
  setHidden(elements.problemStatementPreview, !problem.title);
  setHidden(elements.problemDetails, !hasExpandedContext);
  renderProblemExamples(problem.exampleCards, problem.examples);
  renderProblemConstraints(problem.constraints);

  if (problem.link) {
    elements.problemLink.href = problem.link;
    setHidden(elements.problemLink, false);
    setText(elements.problemLink, "Open on LeetCode");
  } else {
    elements.problemLink.removeAttribute("href");
    setHidden(elements.problemLink, true);
  }

  if (problem.difficulty) {
    setText(elements.difficultyBadge, problem.difficulty);
    elements.difficultyBadge.classList.remove("badge--easy", "badge--medium", "badge--hard");
    elements.difficultyBadge.classList.add(`badge--${problem.difficulty.toLowerCase()}`);
    setHidden(elements.difficultyBadge, false);
  } else {
    setText(elements.difficultyBadge, "");
    elements.difficultyBadge.classList.remove("badge--easy", "badge--medium", "badge--hard");
    setHidden(elements.difficultyBadge, true);
  }

  elements.tagList.innerHTML = "";
  tags.forEach((tag) => {
    const chip = document.createElement("span");
    chip.className = "tag";
    chip.textContent = tag;
    elements.tagList.appendChild(chip);
  });
  saveWorkspaceSnapshot();
  void loadStudyData(problem.titleSlug);
}

// Both buttons use the same request/render flow, with different URLs and messages.
export function loadDaily() {
  return loadProblemRequest("/api/daily/", true);
}

export function loadProblem() {
  if (state.loading) {
    return;
  }
  const identifier = elements.problemIdentifier.value.trim();
  if (!identifier) {
    setStatusTone(elements.problemStatus, "error");
    setText(elements.problemStatus, "Enter a problem number, slug, title, or URL first.");
    return;
  }
  return loadProblemRequest(`/api/problem/?identifier=${encodeURIComponent(identifier)}`);
}

async function loadProblemRequest(url, isDaily = false) {
  if (state.loading) {
    return;
  }

  setBusy(true);
  setStatusTone(elements.problemStatus, "loading");
  setText(elements.problemStatus, isDaily ? "Loading today's daily challenge..." : "Looking up problem...");
  const action = isDaily ? "daily challenge" : "lookup";

  try {
    const data = await runWithWakeRetry(() => fetchJson(url), {
      onWakeStart: () => {
        setStatusTone(elements.problemStatus, "loading");
        setText(elements.problemStatus, `Server was asleep. Waking it up and retrying ${action}...`);
      },
      onRetry: () => {
        setText(elements.problemStatus, `Server is awake. Retrying ${action}...`);
      }
    });
    applyProblemState(data.problem);
    setStatusTone(elements.problemStatus, "success");
    setText(elements.problemStatus, isDaily ? "Daily challenge loaded." : "Problem loaded.");
  } catch (error) {
    if (isDaily && isLeetCodeReachabilityError(error)) {
      setStatusTone(elements.problemStatus, "warning");
      setText(elements.problemStatus, "LeetCode daily is not reachable right now. Enter a problem number or slug above and load it manually.");
    } else {
      setStatusTone(elements.problemStatus, "error");
      const timeoutMessage = isDaily ? "Daily problem request timed out." : "Problem lookup timed out.";
      setText(elements.problemStatus, error.name === "AbortError" ? timeoutMessage : error.message);
    }
  } finally {
    setBusy(false);
  }
}
