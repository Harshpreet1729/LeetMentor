(function () {
  const state = {
    problem: null,
    activeMode: "hint",
    loading: false,
    autosaveTimer: null,
    serverWakePromise: null,
    lastHiddenAt: 0,
    lastWakeCheckAt: 0
  };
  const SERVER_WAKE_TIMEOUT_MS = 90000;
  const SERVER_WAKE_RETRY_DELAY_MS = 3000;
  const SERVER_IDLE_THRESHOLD_MS = 4 * 60 * 1000;
  const storageKeys = {
    code: "leetmentor.code",
    note: "leetmentor.note",
    language: "leetmentor.language",
    hintLevel: "leetmentor.hintLevel",
    problemIdentifier: "leetmentor.problemIdentifier",
    problemSnapshot: "leetmentor.problemSnapshot"
  };

  const byId = (id) => document.getElementById(id);
  const els = {
    mentorShell: byId("mentor-output"),
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
    contextTabs: Array.from(document.querySelectorAll("[data-context-tab]")),
    contextPanels: Array.from(document.querySelectorAll("[data-context-panel]")),
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
    askChatgptBtn: byId("askChatgptBtn"),
    youtubeSearchBtn: byId("youtubeSearchBtn"),
    clearOutputBtn: byId("clearOutputBtn"),
    closeOutputBtn: byId("closeOutputBtn"),
    modeButtons: Array.from(document.querySelectorAll("[data-mode]"))
  };

  function setText(element, text) {
    if (!element) {
      return;
    }
    element.textContent = text;
  }

  function setHidden(element, hidden) {
    if (!element) {
      return;
    }
    element.classList.toggle("hidden", hidden);
  }

  function setStatusTone(element, tone) {
    if (!element) {
      return;
    }
    element.classList.remove("status-banner--neutral", "status-banner--loading", "status-banner--success", "status-banner--error");
    element.classList.add(`status-banner--${tone}`);
  }

  function updateServerChip(text, tone) {
    if (!els.serverStateChip) {
      return;
    }
    setText(els.serverStateChip, text);
    els.serverStateChip.classList.remove("topbar-chip--success", "topbar-chip--warning", "topbar-chip--error");
    if (tone) {
      els.serverStateChip.classList.add(`topbar-chip--${tone}`);
    }
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function isResponsePopoverOpen() {
    return Boolean(els.mentorShell?.classList.contains("mentor-shell--response-open"));
  }

  function setResponsePopoverOpen(isOpen, options = {}) {
    if (!els.mentorShell || !els.mentorResponsePanel) {
      return;
    }

    els.mentorShell.classList.toggle("mentor-shell--response-open", isOpen);
    setHidden(els.closeOutputBtn, !isOpen);
    els.mentorResponsePanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    if (els.mentorResponseBackdrop) {
      els.mentorResponseBackdrop.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }

    if (isOpen) {
      window.requestAnimationFrame(() => {
        if (els.assistantOutput) {
          els.assistantOutput.scrollTop = 0;
        }
        if (options.focusPanel) {
          els.mentorResponsePanel.focus({ preventScroll: true });
        }
      });
    }
  }

  function setContextTab(tabName) {
    els.contextTabs.forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-context-tab") === tabName);
    });
    els.contextPanels.forEach((panel) => {
      panel.classList.toggle("hidden", panel.getAttribute("data-context-panel") !== tabName);
    });
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function renderInlineMarkdown(text) {
    let html = escapeHtml(text);
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return html;
  }

  function renderList(lines, ordered) {
    const tag = ordered ? "ol" : "ul";
    const items = lines.map((line, index) => {
      const content = ordered
        ? line.replace(/^\d+\.\s+/, "")
        : line.replace(/^-\s+/, "");
      return `<li>${renderInlineMarkdown(content)}</li>`;
    });
    return `<${tag}>${items.join("")}</${tag}>`;
  }

  function normalizeAssistantText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/(### [^\n`]+?)\s+```/g, "$1\n\n```")
      .replace(/(### [^\n]+?)\s+(?=\d+\.\s)/g, "$1\n\n")
      .replace(/(### [^\n]+?)\s+(?=[A-Z][a-z])/g, "$1\n\n")
      .replace(/```(\w+)?\s+/g, (_, language) => `\n\`\`\`${language || ""}\n`)
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function renderTextBlock(text) {
    return text
      .trim()
      .split(/\n{2,}/)
      .map((segment) => {
        const cleaned = segment.trim();
        if (!cleaned) {
          return "";
        }

        if (cleaned.startsWith("## ")) {
          return `<h2>${renderInlineMarkdown(cleaned.slice(3))}</h2>`;
        }
        if (cleaned.startsWith("### ")) {
          return `<h3>${renderInlineMarkdown(cleaned.slice(4))}</h3>`;
        }
        if (cleaned.startsWith("#### ")) {
          return `<h4>${renderInlineMarkdown(cleaned.slice(5))}</h4>`;
        }
        if (cleaned.startsWith("> ")) {
          return `<blockquote>${renderInlineMarkdown(cleaned.replace(/^>\s?/, ""))}</blockquote>`;
        }
        if (cleaned.startsWith("\\[") && cleaned.endsWith("\\]")) {
          return `<div class="math-block">${cleaned}</div>`;
        }

        const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.every((line) => /^-\s+/.test(line))) {
          return renderList(lines, false);
        }
        if (lines.every((line) => /^\d+\.\s+/.test(line))) {
          return renderList(lines, true);
        }

        return `<p>${renderInlineMarkdown(cleaned).replace(/\n/g, "<br>")}</p>`;
      })
      .join("");
  }

  function renderAssistantOutput(text) {
    const source = normalizeAssistantText(text);
    if (!source) {
      els.assistantOutput.innerHTML = "<p>No answer yet.</p>";
      return;
    }

    const blocks = [];
    const codePattern = /```(\w+)?\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codePattern.exec(source)) !== null) {
      if (match.index > lastIndex) {
        blocks.push({ type: "text", content: source.slice(lastIndex, match.index) });
      }
      blocks.push({ type: "code", language: match[1] || "", content: match[2] });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < source.length) {
      blocks.push({ type: "text", content: source.slice(lastIndex) });
    }

    const html = blocks
      .map((block) => {
        if (block.type === "code") {
          return `<pre><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.content.trim())}</code></pre>`;
        }
        return renderTextBlock(block.content);
      })
      .join("");

    els.assistantOutput.innerHTML = html;
    els.assistantOutput.scrollTop = 0;

    if (window.MathJax && window.MathJax.typesetPromise) {
      window.MathJax.typesetPromise([els.assistantOutput]).catch(() => {});
    }
  }

  function renderMultilineText(text) {
    return escapeHtml(String(text || "")).replace(/\n/g, "<br>");
  }

  function renderProblemExamples(exampleCards, exampleStrings) {
    const cards = Array.isArray(exampleCards) ? exampleCards : [];
    const examples = Array.isArray(exampleStrings) ? exampleStrings : [];

    if (!cards.length && !examples.length) {
      els.problemExamples.innerHTML = '<p class="detail-empty">No examples available.</p>';
      return;
    }

    if (cards.length) {
      els.problemExamples.innerHTML = cards
        .map((card, index) => {
          const parts = [];
          const title = escapeHtml(card.title || `Example ${index + 1}`);

          if (card.input) {
            parts.push(
              `<div class="detail-item"><span class="detail-item__label">Input</span><p>${renderMultilineText(card.input)}</p></div>`
            );
          }
          if (card.output) {
            parts.push(
              `<div class="detail-item"><span class="detail-item__label">Output</span><p>${renderMultilineText(card.output)}</p></div>`
            );
          }
          if (card.explanation) {
            parts.push(
              `<div class="detail-item"><span class="detail-item__label">Explanation</span><p>${renderMultilineText(card.explanation)}</p></div>`
            );
          }
          if (Array.isArray(card.notes) && card.notes.length) {
            parts.push(
              `<div class="detail-item"><span class="detail-item__label">Notes</span><ul class="detail-list">${card.notes.map((note) => `<li>${renderMultilineText(note)}</li>`).join("")}</ul></div>`
            );
          }
          if (card.body) {
            parts.push(
              `<div class="detail-item"><span class="detail-item__label">Details</span><p>${renderMultilineText(card.body)}</p></div>`
            );
          }

          return `<article class="example-card"><h4 class="example-card__title">${title}</h4>${parts.join("")}</article>`;
        })
        .join("");
      return;
    }

    els.problemExamples.innerHTML = examples
      .map((example, index) => `<article class="example-card"><h4 class="example-card__title">Example ${index + 1}</h4><p>${renderMultilineText(example)}</p></article>`)
      .join("");
  }

  function renderProblemConstraints(constraints) {
    const items = Array.isArray(constraints) ? constraints.filter(Boolean) : [];

    if (!items.length) {
      els.problemConstraints.innerHTML = '<p class="detail-empty">No constraints available.</p>';
      return;
    }

    els.problemConstraints.innerHTML = `<ul class="constraint-list">${items
      .map((constraint) => `<li>${renderMultilineText(constraint)}</li>`)
      .join("")}</ul>`;
  }

  function problemPreviewText(problem) {
    const statement = String(problem?.statement || "").replace(/\s+/g, " ").trim();
    if (!statement) {
      return "Load a problem to see a concise summary here.";
    }
    return statement.length > 180 ? `${statement.slice(0, 180).trimEnd()}...` : statement;
  }

  function saveWorkspaceSnapshot() {
    localStorage.setItem(storageKeys.code, els.codeInput.value);
    localStorage.setItem(storageKeys.note, els.questionInput ? els.questionInput.value : "");
    localStorage.setItem(storageKeys.language, els.languageSelect.value);
    localStorage.setItem(storageKeys.hintLevel, els.hintLevelSelect.value);
    localStorage.setItem(storageKeys.problemIdentifier, els.problemIdentifier.value);
    if (state.problem) {
      localStorage.setItem(storageKeys.problemSnapshot, JSON.stringify(state.problem));
    }
  }

  function queueAutosave(source) {
    window.clearTimeout(state.autosaveTimer);
    if (source === "code" && els.editorAutosave) {
      setText(els.editorAutosave, "Saving locally...");
    }
    if (source === "note" && els.noteAutosave) {
      setText(els.noteAutosave, "Saving note...");
    }
    state.autosaveTimer = window.setTimeout(() => {
      saveWorkspaceSnapshot();
      if (els.editorAutosave) {
        setText(els.editorAutosave, "Autosaved locally");
      }
      if (els.noteAutosave) {
        setText(els.noteAutosave, "Notes are saved locally in this browser.");
      }
    }, 180);
  }

  function restoreWorkspaceSnapshot() {
    const savedCode = localStorage.getItem(storageKeys.code);
    const savedNote = localStorage.getItem(storageKeys.note);
    const savedLanguage = localStorage.getItem(storageKeys.language);
    const savedHintLevel = localStorage.getItem(storageKeys.hintLevel);
    const savedProblemIdentifier = localStorage.getItem(storageKeys.problemIdentifier);
    const savedProblem = localStorage.getItem(storageKeys.problemSnapshot);

    if (savedLanguage) {
      els.languageSelect.value = savedLanguage;
    }
    if (savedHintLevel) {
      els.hintLevelSelect.value = savedHintLevel;
    }
    if (savedProblemIdentifier) {
      els.problemIdentifier.value = savedProblemIdentifier;
    }
    if (savedCode) {
      els.codeInput.value = savedCode;
      if (els.editorAutosave) {
        setText(els.editorAutosave, "Restored local draft");
      }
    }
    if (savedNote && els.questionInput) {
      els.questionInput.value = savedNote;
    }
    if (savedProblem) {
      try {
        const parsed = JSON.parse(savedProblem);
        if (parsed && typeof parsed === "object") {
          applyProblemState(parsed);
          setStatusTone(els.problemStatus, "neutral");
          setText(els.problemStatus, "Restored your last loaded problem.");
        }
      } catch (error) {
        localStorage.removeItem(storageKeys.problemSnapshot);
      }
    }
  }

  function buildChatGptPrompt() {
    if (!state.problem) {
      return "";
    }

    const problem = state.problem;
    const pieces = [
      `Help me solve this LeetCode problem without directly dumping the full solution unless I ask for it.`,
      "",
      `Title: ${problem.questionFrontendId}. ${problem.title}`,
      `Difficulty: ${problem.difficulty || "Unknown"}`,
      `Tags: ${(problem.tags || []).join(", ") || "Not available"}`,
      "",
      "Problem statement:",
      problem.statement || "Not available",
    ];

    if (Array.isArray(problem.examples) && problem.examples.length) {
      pieces.push("", "Examples:", problem.examples.join("\n\n"));
    }

    if (Array.isArray(problem.constraints) && problem.constraints.length) {
      pieces.push("", "Constraints:", problem.constraints.map((item) => `- ${item}`).join("\n"));
    }

    if (els.codeInput.value.trim()) {
      pieces.push("", `My current ${els.languageSelect.value} code:`, "```", els.codeInput.value.trim(), "```");
    }

    if (els.questionInput && els.questionInput.value.trim()) {
      pieces.push("", `What I want help with: ${els.questionInput.value.trim()}`);
    }

    return pieces.join("\n");
  }

  async function openChatGptWithProblem() {
    if (!state.problem) {
      setStatusTone(els.assistantStatus, "error");
      setText(els.assistantStatus, "Load a problem first so there is something to send.");
      return;
    }

    const prompt = buildChatGptPrompt();
    const quickPrompt = `Give me the solution of ${state.problem.questionFrontendId}. ${state.problem.title} on LeetCode.`;
    const chatGptUrl = `https://chatgpt.com/?q=${encodeURIComponent(quickPrompt)}`;

    try {
      await navigator.clipboard.writeText(prompt);
      setStatusTone(els.assistantStatus, "success");
      setText(els.assistantStatus, "ChatGPT opened with a prompt, and the full problem was copied.");
      setText(els.nextStep, "Next step: if the prompt box is empty, paste the copied problem with Ctrl+V.");
      els.nextStep.classList.remove("hidden");
    } catch (error) {
      setStatusTone(els.assistantStatus, "warning");
      setText(els.assistantStatus, "ChatGPT opened with a prompt, but clipboard copy was blocked by the browser.");
      setText(els.nextStep, "Next step: if you need more context than the title prompt, copy the problem manually.");
      els.nextStep.classList.remove("hidden");
    }

    window.open(chatGptUrl, "_blank", "noopener,noreferrer");
  }

  function openYouTubeWithProblem() {
    if (!state.problem) {
      setStatusTone(els.assistantStatus, "error");
      setText(els.assistantStatus, "Load a problem first so the YouTube search knows what to look for.");
      return;
    }

    const searchTitle = state.problem.title ? `leetcode ${state.problem.title} solution` : `leetcode ${state.problem.questionFrontendId} solution`;
    const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTitle)}`;

    setStatusTone(els.assistantStatus, "success");
    setText(els.assistantStatus, "YouTube search opened in a new tab.");
    setText(els.nextStep, "Next step: pick a walkthrough that matches your language and only use it after you try your own idea.");
    els.nextStep.classList.remove("hidden");

    window.open(youtubeUrl, "_blank", "noopener,noreferrer");
  }

  function getCsrfToken() {
    const metaToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute("content");
    if (metaToken && metaToken !== "NOTPROVIDED") {
      return metaToken;
    }

    const cookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("csrftoken="));

    return cookie ? decodeURIComponent(cookie.split("=")[1]) : "";
  }

  function legacySetProblem(problem) {
    state.problem = problem;
    const tags = (problem.tags || []).join(", ");
    setText(els.problemTitle, problem.title ? `${problem.questionFrontendId}. ${problem.title}` : "Unknown problem");
    setText(els.problemStatementPreview, problemPreviewText(problem));
    setText(
      els.problemStatement,
      problem.title
        ? `Difficulty: ${problem.difficulty || "Unknown"}${tags ? ` • Topics: ${tags}` : ""}`
        : "Full statement stays on LeetCode. Load a problem here to see its title, difficulty, and topic tags."
    );
    setText(
      els.workspaceProblemMeta,
      problem.title
        ? `${problem.questionFrontendId}. ${problem.title} · ${problem.difficulty || "Unknown"}${(problem.tags || []).length ? ` · ${(problem.tags || []).slice(0, 3).join(" · ")}` : ""}`
        : "Load a problem to begin a guided practice session."
    );
    if (problem.title) {
      setText(
        els.problemStatement,
        `Difficulty: ${problem.difficulty || "Unknown"}${tags ? ` - Topics: ${tags}` : ""}`
      );
      setText(
        els.workspaceProblemMeta,
        `${problem.questionFrontendId}. ${problem.title} - ${problem.difficulty || "Unknown"}${(problem.tags || []).length ? ` - ${(problem.tags || []).slice(0, 3).join(" - ")}` : ""}`
      );
    }
    renderProblemExamples(problem.exampleCards, problem.examples);
    renderProblemConstraints(problem.constraints);
    setContextTab("statement");

    if (problem.link) {
      els.problemLink.href = problem.link;
      els.problemLink.classList.remove("hidden");
      setText(els.problemLink, "Open on LeetCode");
    } else {
      els.problemLink.removeAttribute("href");
      els.problemLink.classList.add("hidden");
    }

    if (problem.difficulty) {
      setText(els.difficultyBadge, problem.difficulty);
      els.difficultyBadge.classList.remove("hidden");
    } else {
      setText(els.difficultyBadge, "");
      els.difficultyBadge.classList.add("hidden");
    }

    els.tagList.innerHTML = "";
    (problem.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      els.tagList.appendChild(chip);
    });
    saveWorkspaceSnapshot();
  }

  function applyProblemState(problem) {
    state.problem = problem;
    const tags = Array.isArray(problem.tags) ? problem.tags.filter(Boolean) : [];
    const summaryTags = tags.slice(0, 3);
    const difficulty = problem.difficulty || "Unknown";
    const hasExpandedContext = Boolean(
      (Array.isArray(problem.exampleCards) && problem.exampleCards.length) ||
      (Array.isArray(problem.examples) && problem.examples.length) ||
      (Array.isArray(problem.constraints) && problem.constraints.length)
    );

    setText(els.problemTitle, problem.title ? `${problem.questionFrontendId}. ${problem.title}` : "Unknown problem");
    setText(els.problemStatementPreview, problemPreviewText(problem));
    setText(
      els.problemStatement,
      problem.title
        ? `Difficulty: ${difficulty}${tags.length ? ` - Topics: ${tags.join(", ")}` : ""}`
        : "Difficulty, topics, and a short summary appear here after you load a problem."
    );
    setText(
      els.workspaceProblemMeta,
      problem.title
        ? `${problem.questionFrontendId}. ${problem.title} - ${difficulty}${summaryTags.length ? ` - ${summaryTags.join(" - ")}` : ""}`
        : "Load a problem to begin a guided practice session."
    );
    setHidden(els.problemStatementPreview, !problem.title);
    setHidden(els.problemDetails, !hasExpandedContext);
    renderProblemExamples(problem.exampleCards, problem.examples);
    renderProblemConstraints(problem.constraints);
    setContextTab("statement");

    if (problem.link) {
      els.problemLink.href = problem.link;
      setHidden(els.problemLink, false);
      setText(els.problemLink, "Open on LeetCode");
    } else {
      els.problemLink.removeAttribute("href");
      setHidden(els.problemLink, true);
    }

    if (problem.difficulty) {
      setText(els.difficultyBadge, problem.difficulty);
      els.difficultyBadge.classList.remove("badge--easy", "badge--medium", "badge--hard");
      els.difficultyBadge.classList.add(`badge--${problem.difficulty.toLowerCase()}`);
      setHidden(els.difficultyBadge, false);
    } else {
      setText(els.difficultyBadge, "");
      els.difficultyBadge.classList.remove("badge--easy", "badge--medium", "badge--hard");
      setHidden(els.difficultyBadge, true);
    }

    els.tagList.innerHTML = "";
    tags.forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = tag;
      els.tagList.appendChild(chip);
    });
    saveWorkspaceSnapshot();
  }

  function setActiveMode(mode) {
    state.activeMode = mode;
    els.modeButtons.forEach((button) => {
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

  function updateEditorFilename() {
    if (!els.editorFilename || !els.languageSelect) {
      return;
    }
    els.editorFilename.textContent = `solution.${languageExtension(els.languageSelect.value)}`;
  }

  function setBusy(isBusy) {
    state.loading = isBusy;
    els.modeButtons.forEach((button) => {
      button.disabled = isBusy;
      button.setAttribute("aria-busy", isBusy && button.getAttribute("data-mode") === state.activeMode ? "true" : "false");
    });

    els.loadProblemBtn.disabled = isBusy;
    els.dailyBtn.disabled = isBusy;
    if (els.askChatgptBtn) {
      els.askChatgptBtn.disabled = isBusy;
    }
    if (els.youtubeSearchBtn) {
      els.youtubeSearchBtn.disabled = isBusy;
    }
    if (isBusy) {
      updateServerChip("Working...", "warning");
    } else if (!els.serverStateChip.classList.contains("topbar-chip--error")) {
      updateServerChip("Server ready", "success");
    }
  }

  function createRequestError(message, statusCode) {
    const error = new Error(message || "Request failed.");
    if (typeof statusCode === "number") {
      error.statusCode = statusCode;
    }
    return error;
  }

  async function fetchJson(url, options, timeoutMs = 25000) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { ...(options || {}), signal: controller.signal });
      const contentType = response.headers.get("content-type") || "";
      let data;

      if (contentType.includes("application/json")) {
        data = await response.json();
      } else {
        const text = await response.text();
        throw createRequestError(
          text.startsWith("<!DOCTYPE") ? "The server is waking up. Retrying shortly..." : text || "Request failed.",
          response.status
        );
      }

      if (!response.ok || !data.ok) {
        throw createRequestError(data.message || "Request failed.", response.status);
      }

      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  function isRecoverableWakeError(error) {
    if (!error) {
      return false;
    }

    if (error.name === "AbortError") {
      return true;
    }

    if (typeof error.statusCode === "number" && error.statusCode >= 500) {
      return true;
    }

    const message = String(error.message || "").toLowerCase();
    return [
      "waking up",
      "failed to fetch",
      "request failed",
      "timed out",
      "html error page",
      "service unavailable",
      "bad gateway",
      "gateway timeout"
    ].some((snippet) => message.includes(snippet));
  }

  async function waitForServerWake() {
    if (state.serverWakePromise) {
      return state.serverWakePromise;
    }

    state.serverWakePromise = (async () => {
      const startedAt = Date.now();
      updateServerChip("Waking server...", "warning");

      while (Date.now() - startedAt < SERVER_WAKE_TIMEOUT_MS) {
        try {
          await fetchJson("/api/health/", undefined, 12000);
          updateServerChip("Server ready", "success");
          state.lastWakeCheckAt = Date.now();
          return true;
        } catch (error) {
          updateServerChip("Still waking...", "warning");
          await delay(SERVER_WAKE_RETRY_DELAY_MS);
        }
      }

      updateServerChip("Server unreachable", "error");
      throw new Error("The server is still waking up. Please wait a few seconds and try again.");
    })();

    try {
      return await state.serverWakePromise;
    } finally {
      state.serverWakePromise = null;
    }
  }

  async function runWithWakeRetry(task, handlers = {}) {
    try {
      return await task();
    } catch (error) {
      if (!isRecoverableWakeError(error)) {
        throw error;
      }

      if (typeof handlers.onWakeStart === "function") {
        handlers.onWakeStart(error);
      }

      await waitForServerWake();

      if (typeof handlers.onRetry === "function") {
        handlers.onRetry();
      }

      return task();
    }
  }

  function warmServerInBackground() {
    const now = Date.now();
    if (state.loading || state.serverWakePromise || now - state.lastWakeCheckAt < 30000) {
      return;
    }

    state.lastWakeCheckAt = now;
    updateServerChip("Checking server...", "warning");
    waitForServerWake().catch(() => {
      updateServerChip("Wake check failed", "error");
    });
  }

  async function loadDaily() {
    if (state.loading) {
      return;
    }

    setBusy(true);
    setStatusTone(els.problemStatus, "loading");
    setText(els.problemStatus, "Loading today's daily challenge...");

    try {
      const data = await runWithWakeRetry(
        () => fetchJson("/api/daily/"),
        {
          onWakeStart: () => {
            setStatusTone(els.problemStatus, "loading");
            setText(els.problemStatus, "Server was asleep. Waking it up and retrying daily challenge...");
          },
          onRetry: () => {
            setText(els.problemStatus, "Server is awake. Retrying daily challenge...");
          }
        }
      );
      applyProblemState(data.problem);
      setStatusTone(els.problemStatus, "success");
      setText(els.problemStatus, "Daily challenge loaded.");
    } catch (error) {
      setStatusTone(els.problemStatus, "error");
      setText(els.problemStatus, error.name === "AbortError" ? "Daily problem request timed out." : error.message);
    } finally {
      setBusy(false);
    }
  }

  async function loadProblem() {
    if (state.loading) {
      return;
    }

    const identifier = els.problemIdentifier.value.trim();
    if (!identifier) {
      setStatusTone(els.problemStatus, "error");
      setText(els.problemStatus, "Enter a problem number, slug, title, or URL first.");
      return;
    }

    setBusy(true);
    setStatusTone(els.problemStatus, "loading");
    setText(els.problemStatus, "Looking up problem...");

    try {
      const data = await runWithWakeRetry(
        () => fetchJson(`/api/problem/?identifier=${encodeURIComponent(identifier)}`),
        {
          onWakeStart: () => {
            setStatusTone(els.problemStatus, "loading");
            setText(els.problemStatus, "Server was asleep. Waking it up and retrying lookup...");
          },
          onRetry: () => {
            setText(els.problemStatus, "Server is awake. Retrying lookup...");
          }
        }
      );
      applyProblemState(data.problem);
      setStatusTone(els.problemStatus, "success");
      setText(els.problemStatus, "Problem loaded.");
    } catch (error) {
      setStatusTone(els.problemStatus, "error");
      setText(els.problemStatus, error.name === "AbortError" ? "Problem lookup timed out." : error.message);
    } finally {
      setBusy(false);
    }
  }

  async function runAssistant(mode) {
    if (state.loading) {
      return;
    }

    if (!state.problem) {
      setStatusTone(els.assistantStatus, "error");
      setText(els.assistantStatus, "Load a problem first so the mentor has context.");
      return;
    }

    const payload = {
      mode,
      problem: state.problem,
      userCode: els.codeInput.value.trim(),
      language: els.languageSelect.value,
      userQuestion: els.questionInput ? els.questionInput.value.trim() : "",
      hintLevel: Number(els.hintLevelSelect.value)
    };

    if (mode === "debug" && !payload.userCode) {
      setResponsePopoverOpen(true, { focusPanel: true });
      setStatusTone(els.assistantStatus, "error");
      setText(els.assistantStatus, "Add your code first so the mentor can review the actual solution.");
      renderAssistantOutput([
        "### Missing code",
        "Paste your current solution in the editor first, then use **Review my code**.",
        "",
        "### What I will check",
        "- correctness and edge cases",
        "- likely bug points",
        "- cleaner logic if needed",
      ].join("\n"));
      return;
    }

    setResponsePopoverOpen(true, { focusPanel: true });
    setBusy(true);
    setStatusTone(els.assistantStatus, "loading");
    setText(els.assistantStatus, "Thinking...");
    els.assistantOutput.innerHTML = '<div class="response-skeleton"><span></span><span></span><span></span></div>';
    els.nextStep.classList.add("hidden");

    try {
      const data = await runWithWakeRetry(
        () => fetchJson(
          "/api/assistant/",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": getCsrfToken()
            },
            body: JSON.stringify(payload)
          },
          30000
        ),
        {
          onWakeStart: () => {
            setStatusTone(els.assistantStatus, "loading");
            setText(els.assistantStatus, "Server was asleep. Waking it up and retrying your request...");
          },
          onRetry: () => {
            setText(els.assistantStatus, "Server is awake. Retrying your request...");
          }
        }
      );

      renderAssistantOutput(data.answer);
      setStatusTone(els.assistantStatus, "success");
      setText(els.assistantStatus, "Ready.");
      if (data.suggestedNextStep) {
        setText(els.nextStep, `Next step: ${data.suggestedNextStep}`);
        els.nextStep.classList.remove("hidden");
      }
    } catch (error) {
      setStatusTone(els.assistantStatus, "error");
      setText(els.assistantStatus, error.name === "AbortError" ? "The mentor took too long. Try again." : error.message);
      renderAssistantOutput([
        "### Request failed",
        error.name === "AbortError"
          ? "The mentor response timed out. Try the same action once more."
          : String(error.message || "The request failed."),
      ].join("\n\n"));
    } finally {
      setBusy(false);
    }
  }

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.getAttribute("data-mode");
      setActiveMode(mode);
      runAssistant(mode);
    });
  });

  els.contextTabs.forEach((button) => {
    button.addEventListener("click", () => {
      setContextTab(button.getAttribute("data-context-tab"));
    });
  });

  els.dailyBtn.addEventListener("click", loadDaily);
  els.loadProblemBtn.addEventListener("click", loadProblem);
  if (els.askChatgptBtn) {
    els.askChatgptBtn.addEventListener("click", openChatGptWithProblem);
  }
  if (els.youtubeSearchBtn) {
    els.youtubeSearchBtn.addEventListener("click", openYouTubeWithProblem);
  }
  if (els.mentorResponseBackdrop) {
    els.mentorResponseBackdrop.addEventListener("click", () => {
      setResponsePopoverOpen(false);
    });
  }
  if (els.closeOutputBtn) {
    els.closeOutputBtn.addEventListener("click", () => {
      setResponsePopoverOpen(false);
    });
  }
  els.clearOutputBtn.addEventListener("click", () => {
    setStatusTone(els.assistantStatus, "neutral");
    setText(els.assistantStatus, "Output cleared.");
    renderAssistantOutput("Your explanation, hint, code review, or dry run will appear here.");
    setText(els.nextStep, "");
    els.nextStep.classList.add("hidden");
    setResponsePopoverOpen(false);
  });

  els.problemIdentifier.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadProblem();
    }
  });

  els.languageSelect.addEventListener("change", () => {
    updateEditorFilename();
    saveWorkspaceSnapshot();
  });
  els.hintLevelSelect.addEventListener("change", saveWorkspaceSnapshot);
  els.problemIdentifier.addEventListener("input", saveWorkspaceSnapshot);
  els.codeInput.addEventListener("input", () => queueAutosave("code"));
  if (els.questionInput) {
    els.questionInput.addEventListener("input", () => queueAutosave("note"));
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      state.lastHiddenAt = Date.now();
      return;
    }

    const wasHiddenLongEnough = state.lastHiddenAt && Date.now() - state.lastHiddenAt >= SERVER_IDLE_THRESHOLD_MS;
    state.lastHiddenAt = 0;
    if (wasHiddenLongEnough) {
      warmServerInBackground();
    }
  });
  window.addEventListener("focus", () => {
    if (state.lastHiddenAt && Date.now() - state.lastHiddenAt >= SERVER_IDLE_THRESHOLD_MS) {
      warmServerInBackground();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isResponsePopoverOpen()) {
      setResponsePopoverOpen(false);
    }
  });

  setActiveMode("hint");
  setContextTab("statement");
  restoreWorkspaceSnapshot();
  updateEditorFilename();
  updateServerChip("Server ready", "success");
  setStatusTone(els.problemStatus, "neutral");
  setStatusTone(els.assistantStatus, "neutral");
  setResponsePopoverOpen(false);
  renderAssistantOutput("Your explanation, hint, code review, or dry run will appear here.");
})();
