export const state = {
  problem: null,
  activeMode: "hint",
  loading: false,
  autosaveTimer: null,
  serverWakePromise: null,
  lastHiddenAt: 0,
  lastWakeCheckAt: 0,
  activeLanguage: "C++",
  responseTrigger: null,
  lastAssistantText: "",
  studyLoadVersion: 0,
  studySaving: false
};
const byId = (id) => document.getElementById(id);
export const elements = {
  mentorResponsePanel: byId("mentorResponsePanel"),
  mentorResponseBackdrop: byId("mentorResponseBackdrop"),
  problemIdentifier: byId("problemIdentifier"),
  problemStatus: byId("problemStatus"),
  dailyBtn: byId("dailyBtn"),
  loadProblemBtn: byId("loadProblemBtn"),
  difficultyBadge: byId("difficultyBadge"),
  workspaceProblemMeta: byId("workspaceProblemMeta"),
  serverStateChip: byId("serverStateChip"),
  problemTitle: byId("problemTitle"),
  problemLink: byId("problemLink"),
  problemStatementPreview: byId("problemStatementPreview"),
  problemStatement: byId("problemStatement"),
  problemDetails: document.querySelector("#problem-context .detail-toggle"),
  problemExamples: byId("problemExamples"),
  problemConstraints: byId("problemConstraints"),
  tagList: byId("tagList"),
  codeInput: byId("codeInput"),
  editorFilename: byId("editorFilename"),
  editorAutosave: byId("editorAutosave"),
  languageSelect: byId("languageSelect"),
  hintLevelSelect: byId("hintLevelSelect"),
  questionInput: byId("questionInput"),
  noteAutosave: byId("noteAutosave"),
  assistantStatus: byId("assistantStatus"),
  assistantOutput: byId("assistantOutput"),
  nextStep: byId("nextStep"),
  studyStatus: byId("studyStatus"),
  studyConfidence: byId("studyConfidence"),
  studyMistakeCategory: byId("studyMistakeCategory"),
  studyReflection: byId("studyReflection"),
  saveStudyBtn: byId("saveStudyBtn"),
  studySaveStatus: byId("studySaveStatus"),
  studyNextReview: byId("studyNextReview"),
  reviewQueue: byId("reviewQueue"),
  askChatgptBtn: byId("askChatgptBtn"),
  youtubeSearchBtn: byId("youtubeSearchBtn"),
  copyOutputBtn: byId("copyOutputBtn"),
  clearOutputBtn: byId("clearOutputBtn"),
  closeOutputBtn: byId("closeOutputBtn"),
  modeButtons: Array.from(document.querySelectorAll("[data-mode]"))
};

export function setText(element, text) {
  if (!element) {
    return;
  }
  element.textContent = text;
}

export function setHidden(element, hidden) {
  if (!element) {
    return;
  }
  element.classList.toggle("hidden", hidden);
}

export function setStatusTone(element, tone) {
  if (!element) {
    return;
  }
  element.classList.remove("status-banner--neutral", "status-banner--loading", "status-banner--success", "status-banner--warning", "status-banner--error");
  element.classList.add(`status-banner--${tone}`);
}

export function updateServerChip(text, tone) {
  if (!elements.serverStateChip) {
    return;
  }
  setText(elements.serverStateChip, text);
  elements.serverStateChip.classList.remove("topbar-chip--success", "topbar-chip--warning", "topbar-chip--error");
  if (tone) {
    elements.serverStateChip.classList.add(`topbar-chip--${tone}`);
  }
}

export function setActiveMode(mode) {
  state.activeMode = mode;
  elements.modeButtons.forEach((button) => {
    button.classList.toggle("active", button.getAttribute("data-mode") === mode);
  });
}

function languageExtension(language) {
  const extensions = {
    "C++": "cpp",
    Python: "py",
    Java: "java",
    JavaScript: "js"
  };
  return extensions[language] || "txt";
}

export function updateEditorFilename() {
  if (!elements.editorFilename || !elements.languageSelect) {
    return;
  }
  elements.editorFilename.textContent = `solution.${languageExtension(elements.languageSelect.value)}`;
}

export function setBusy(isBusy) {
  state.loading = isBusy;
  elements.modeButtons.forEach((button) => {
    button.disabled = isBusy;
    button.setAttribute("aria-busy", isBusy && button.getAttribute("data-mode") === state.activeMode ? "true" : "false");
  });

  elements.loadProblemBtn.disabled = isBusy;
  elements.dailyBtn.disabled = isBusy;
  if (elements.askChatgptBtn) {
    elements.askChatgptBtn.disabled = isBusy;
  }
  if (elements.youtubeSearchBtn) {
    elements.youtubeSearchBtn.disabled = isBusy;
  }
  if (isBusy) {
    updateServerChip("Working...", "warning");
  } else if (!elements.serverStateChip.classList.contains("topbar-chip--error")) {
    updateServerChip("Server ready", "success");
  }
}
