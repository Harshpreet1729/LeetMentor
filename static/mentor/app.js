import {
  state,
  elements,
  setText,
  setStatusTone,
  updateServerChip,
  setActiveMode,
  updateEditorFilename
} from "./workspace.js?v=20260912-names";
import { renderAssistantOutput } from "./rendering.js?v=20260912-names";
import {
  saveDraftFor,
  restoreDraftFor,
  saveWorkspace,
  queueAutosave,
  restoreWorkspace
} from "./drafts.js?v=20260912-names";
import { SERVER_IDLE_THRESHOLD_MS, wakeServer } from "./api.js?v=20260912-names";
import { loadStudyData, saveStudyRecord, markStudyReviewed } from "./study.js?v=20260912-names";
import { showProblem, loadDaily, loadProblem } from "./problems.js?v=20260912-names";
import {
  isAnswerOpen,
  setAnswerOpen,
  openChatGpt,
  openYouTube,
  runAssistant
} from "./assistant.js?v=20260912-names";
elements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const mode = button.getAttribute("data-mode");
    setActiveMode(mode);
    runAssistant(mode);
  });
});

elements.dailyBtn.addEventListener("click", loadDaily);
elements.loadProblemBtn.addEventListener("click", loadProblem);
if (elements.saveStudyBtn) {
  elements.saveStudyBtn.addEventListener("click", saveStudyRecord);
}
if (elements.reviewQueue) {
  elements.reviewQueue.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) {
      return;
    }

    const loadSlug = target.getAttribute("data-study-load-slug");
    if (loadSlug) {
      elements.problemIdentifier.value = loadSlug;
      saveWorkspace();
      void loadProblem();
      return;
    }

    const reviewSlug = target.getAttribute("data-review-slug");
    if (reviewSlug) {
      const expectedReviewStage = Number(target.getAttribute("data-review-stage"));
      void markStudyReviewed(reviewSlug, expectedReviewStage);
    }
  });
}
if (elements.askChatgptBtn) {
  elements.askChatgptBtn.addEventListener("click", openChatGpt);
}
if (elements.youtubeSearchBtn) {
  elements.youtubeSearchBtn.addEventListener("click", openYouTube);
}
if (elements.mentorResponseBackdrop) {
  elements.mentorResponseBackdrop.addEventListener("click", () => {
    setAnswerOpen(false);
  });
}
if (elements.closeOutputBtn) {
  elements.closeOutputBtn.addEventListener("click", () => {
    setAnswerOpen(false);
  });
}
if (elements.copyOutputBtn) {
  elements.copyOutputBtn.addEventListener("click", async () => {
    const text = state.lastAssistantText.trim();
    if (!text) {
      setStatusTone(elements.assistantStatus, "warning");
      setText(elements.assistantStatus, "There is no mentor output to copy yet.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setStatusTone(elements.assistantStatus, "success");
      setText(elements.assistantStatus, "Mentor output copied.");
    } catch (error) {
      setStatusTone(elements.assistantStatus, "error");
      setText(elements.assistantStatus, "Clipboard access was blocked. Select the output and copy it manually.");
    }
  });
}
elements.clearOutputBtn.addEventListener("click", () => {
  setStatusTone(elements.assistantStatus, "neutral");
  setText(elements.assistantStatus, "Output cleared.");
  renderAssistantOutput("Your explanation, hint, code review, or dry run will appear here.");
  setText(elements.nextStep, "");
  elements.nextStep.classList.add("hidden");
  setAnswerOpen(false);
});

elements.problemIdentifier.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    loadProblem();
  }
});

elements.languageSelect.addEventListener("change", () => {
  const nextLanguage = elements.languageSelect.value;
  if (nextLanguage !== state.activeLanguage) {
    saveDraftFor(state.problem, state.activeLanguage, elements.codeInput.value);
    state.activeLanguage = nextLanguage;
    restoreDraftFor(state.problem, state.activeLanguage);
  }
  updateEditorFilename();
  saveWorkspace();
});
elements.hintLevelSelect.addEventListener("change", saveWorkspace);
elements.problemIdentifier.addEventListener("input", saveWorkspace);
elements.codeInput.addEventListener("input", () => queueAutosave("code"));
if (elements.questionInput) {
  elements.questionInput.addEventListener("input", () => queueAutosave("note"));
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    state.lastHiddenAt = Date.now();
    return;
  }

  const wasAway = state.lastHiddenAt && Date.now() - state.lastHiddenAt >= SERVER_IDLE_THRESHOLD_MS;
  state.lastHiddenAt = 0;
  if (wasAway) {
    wakeServer();
  }
});
window.addEventListener("focus", () => {
  if (state.lastHiddenAt && Date.now() - state.lastHiddenAt >= SERVER_IDLE_THRESHOLD_MS) {
    wakeServer();
  }
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && isAnswerOpen()) {
    setAnswerOpen(false);
    return;
  }

  if (event.key === "Tab" && isAnswerOpen()) {
    const focusable = Array.from(
      elements.mentorResponsePanel.querySelectorAll("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")
    ).filter((element) => !element.hasAttribute("hidden"));
    if (focusable.length) {
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === elements.mentorResponsePanel) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }

  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    runAssistant(state.activeMode);
  }
});

setActiveMode("hint");
const savedWorkspace = restoreWorkspace();
if (savedWorkspace.problem) {
  showProblem(savedWorkspace.problem, {
    legacyDraft: savedWorkspace.legacyDraft,
    restoreDraft: true
  });
  setStatusTone(elements.problemStatus, "neutral");
  setText(elements.problemStatus, "Restored your last loaded problem.");
}
if (!state.problem) {
  void loadStudyData(null);
}
updateEditorFilename();
updateServerChip("Server ready", "success");
setStatusTone(elements.problemStatus, "neutral");
setStatusTone(elements.assistantStatus, "neutral");
setAnswerOpen(false);
renderAssistantOutput("Your explanation, hint, code review, or dry run will appear here.");
