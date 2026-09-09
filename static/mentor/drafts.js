// Keep code drafts per problem/language and workspace preferences in localStorage.
import { state, elements, setText } from "./workspace.js?v=20260910-readability";

const storageKeys = {
  legacyCode: "leetmentor.code",
  note: "leetmentor.note",
  language: "leetmentor.language",
  hintLevel: "leetmentor.hintLevel",
  problemIdentifier: "leetmentor.problemIdentifier",
  problemSnapshot: "leetmentor.problemSnapshot"
};

// Drafts belong to one problem and language, not to the whole workspace.
function draftStorageKey(problem, language) {
  const slug = problem?.titleSlug || "scratchpad";
  return `leetmentor.draft.v2.${encodeURIComponent(slug)}.${encodeURIComponent(language || "C++")}`;
}

export function saveDraftFor(problem, language, code) {
  localStorage.setItem(draftStorageKey(problem, language), code);
}

export function restoreDraftFor(problem, language, options = {}) {
  const key = draftStorageKey(problem, language);
  let draft = localStorage.getItem(key);
  if (draft === null && typeof options.legacyDraft === "string") {
    draft = options.legacyDraft;
    localStorage.setItem(key, draft);
  }

  elements.codeInput.value = draft ?? "";
  if (elements.editorAutosave) {
    setText(
      elements.editorAutosave,
      draft === null
        ? `Fresh ${language} draft for this problem`
        : `Restored saved ${language} draft for this problem`
    );
  }
}

export function saveWorkspaceSnapshot() {
  saveDraftFor(state.problem, state.activeLanguage, elements.codeInput.value);
  localStorage.setItem(storageKeys.note, elements.questionInput ? elements.questionInput.value : "");
  localStorage.setItem(storageKeys.language, elements.languageSelect.value);
  localStorage.setItem(storageKeys.hintLevel, elements.hintLevelSelect.value);
  localStorage.setItem(storageKeys.problemIdentifier, elements.problemIdentifier.value);
  if (state.problem) {
    localStorage.setItem(storageKeys.problemSnapshot, JSON.stringify(state.problem));
  }
}

export function queueAutosave(source) {
  window.clearTimeout(state.autosaveTimer);
  if (source === "code" && elements.editorAutosave) {
    setText(elements.editorAutosave, "Saving locally...");
  }
  if (source === "note" && elements.noteAutosave) {
    setText(elements.noteAutosave, "Saving note...");
  }
  state.autosaveTimer = window.setTimeout(() => {
    saveWorkspaceSnapshot();
    if (elements.editorAutosave) {
      setText(elements.editorAutosave, "Autosaved locally");
    }
    if (elements.noteAutosave) {
      setText(elements.noteAutosave, "Notes are saved locally in this browser.");
    }
  }, 180);
}

export function restoreWorkspaceSnapshot() {
  const savedCode = localStorage.getItem(storageKeys.legacyCode);
  const savedNote = localStorage.getItem(storageKeys.note);
  const savedLanguage = localStorage.getItem(storageKeys.language);
  const savedHintLevel = localStorage.getItem(storageKeys.hintLevel);
  const savedProblemIdentifier = localStorage.getItem(storageKeys.problemIdentifier);
  const savedProblem = localStorage.getItem(storageKeys.problemSnapshot);

  if (savedLanguage) {
    elements.languageSelect.value = savedLanguage;
  }
  state.activeLanguage = elements.languageSelect.value;
  if (savedHintLevel) {
    elements.hintLevelSelect.value = savedHintLevel;
  }
  if (savedProblemIdentifier) {
    elements.problemIdentifier.value = savedProblemIdentifier;
  }
  if (savedNote && elements.questionInput) {
    elements.questionInput.value = savedNote;
  }
  let problem = null;
  if (savedProblem) {
    try {
      const parsed = JSON.parse(savedProblem);
      if (parsed && typeof parsed === "object") {
        problem = parsed;
      }
    } catch (error) {
      localStorage.removeItem(storageKeys.problemSnapshot);
    }
  }
  if (!problem) {
    restoreDraftFor(null, state.activeLanguage, { legacyDraft: savedCode });
  }
  return { problem, legacyDraft: savedCode };
}
