(function () {
  const state = {
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
  const SERVER_WAKE_TIMEOUT_MS = 90000;
  const SERVER_WAKE_RETRY_DELAY_MS = 3000;
  const SERVER_IDLE_THRESHOLD_MS = 4 * 60 * 1000;
  const storageKeys = {
    legacyCode: "leetmentor.code",
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

  if (els.mentorResponseBackdrop && els.mentorResponseBackdrop.parentElement !== document.body) {
    document.body.appendChild(els.mentorResponseBackdrop);
  }
  if (els.mentorResponsePanel && els.mentorResponsePanel.parentElement !== document.body) {
    document.body.appendChild(els.mentorResponsePanel);
  }

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
    return document.body.classList.contains("mentor-response-is-open");
  }

  function setResponsePopoverOpen(isOpen, options = {}) {
    if (!els.mentorShell || !els.mentorResponsePanel) {
      return;
    }

    const wasOpen = isResponsePopoverOpen();
    if (isOpen && !wasOpen) {
      state.responseTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }

    els.mentorShell.classList.toggle("mentor-shell--response-open", isOpen);
    document.body.classList.toggle("mentor-response-is-open", isOpen);
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
    } else if (wasOpen && state.responseTrigger) {
      const trigger = state.responseTrigger;
      state.responseTrigger = null;
      window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
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
    const codeSpans = [];
    let html = String(text || "").replace(/`([^`]+)`/g, (_, code) => {
      const token = `@@CODE_SPAN_${codeSpans.length}@@`;
      codeSpans.push(`<code>${escapeHtml(code)}</code>`);
      return token;
    });
    html = escapeHtml(html);
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/@@CODE_SPAN_(\d+)@@/g, (_, index) => codeSpans[Number(index)] || "");
    return html;
  }

  function renderTechnicalInline(text) {
    const tokens = [];
    const source = String(text || "").replace(
      /(\[[a-zA-Z0-9_,\s-]+\]|\b[a-zA-Z_]\w*\[[^\]]+\]|\b[a-zA-Z]+_[a-zA-Z0-9_]+\b|\bn\s*-\s*1\b)/g,
      (match) => {
        const token = `@@TECH_TOKEN_${tokens.length}@@`;
        tokens.push(`<code>${escapeHtml(match)}</code>`);
        return token;
      }
    );

    return escapeHtml(source).replace(/@@TECH_TOKEN_(\d+)@@/g, (_, index) => tokens[Number(index)] || "");
  }

  function renderList(lines, ordered) {
    const tag = ordered ? "ol" : "ul";
    const items = lines.map((line, index) => {
      const content = ordered
        ? line.replace(/^\d+\.\s+/, "")
        : line.replace(/^[-*]\s+/, "");
      return `<li>${renderInlineMarkdown(content)}</li>`;
    });
    return `<${tag}>${items.join("")}</${tag}>`;
  }

  function normalizeAssistantText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/(### [^\n`]+?)\s+```/g, "$1\n\n```")
      .replace(/(### (?:Coding plan|Steps))\s+[-*]\s+/gi, "$1\n\n- ")
      .replace(/(### (?:Coding plan|Steps))\s+(\d+\.\s+)/gi, "$1\n\n$2")
      .replace(/(### [^\n]+?)\s+(?=\d+\.\s)/g, "$1\n\n")
      .replace(/(### [^\n]+?)\s+(?=[A-Z][a-z])/g, "$1\n\n")
      .replace(/^(#{2,4} [^\n]+)\n(?!\n)/gm, "$1\n\n")
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
          return `<div class="math-block">${escapeHtml(cleaned)}</div>`;
        }

        const lines = cleaned.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.every((line) => /^[-*]\s+/.test(line))) {
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
    state.lastAssistantText = String(text || "");
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

  function renderProblemPreview(problem) {
    if (!els.problemStatementPreview) {
      return;
    }
    els.problemStatementPreview.innerHTML = renderTechnicalInline(problemPreviewText(problem));
  }

  function draftStorageKey(problem, language) {
    const slug = problem?.titleSlug || "scratchpad";
    return `leetmentor.draft.v2.${encodeURIComponent(slug)}.${encodeURIComponent(language || "C++")}`;
  }

  function saveDraftFor(problem, language, code) {
    localStorage.setItem(draftStorageKey(problem, language), code);
  }

  function restoreDraftFor(problem, language, options = {}) {
    const key = draftStorageKey(problem, language);
    let draft = localStorage.getItem(key);
    if (draft === null && typeof options.legacyDraft === "string") {
      draft = options.legacyDraft;
      localStorage.setItem(key, draft);
    }

    els.codeInput.value = draft ?? "";
    if (els.editorAutosave) {
      setText(
        els.editorAutosave,
        draft === null
          ? `Fresh ${language} draft for this problem`
          : `Restored saved ${language} draft for this problem`
      );
    }
  }

  function saveWorkspaceSnapshot() {
    saveDraftFor(state.problem, state.activeLanguage, els.codeInput.value);
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
    const savedCode = localStorage.getItem(storageKeys.legacyCode);
    const savedNote = localStorage.getItem(storageKeys.note);
    const savedLanguage = localStorage.getItem(storageKeys.language);
    const savedHintLevel = localStorage.getItem(storageKeys.hintLevel);
    const savedProblemIdentifier = localStorage.getItem(storageKeys.problemIdentifier);
    const savedProblem = localStorage.getItem(storageKeys.problemSnapshot);

    if (savedLanguage) {
      els.languageSelect.value = savedLanguage;
    }
    state.activeLanguage = els.languageSelect.value;
    if (savedHintLevel) {
      els.hintLevelSelect.value = savedHintLevel;
    }
    if (savedProblemIdentifier) {
      els.problemIdentifier.value = savedProblemIdentifier;
    }
    if (savedNote && els.questionInput) {
      els.questionInput.value = savedNote;
    }
    if (savedProblem) {
      try {
        const parsed = JSON.parse(savedProblem);
        if (parsed && typeof parsed === "object") {
          applyProblemState(parsed, { legacyDraft: savedCode, restoreDraft: true });
          setStatusTone(els.problemStatus, "neutral");
          setText(els.problemStatus, "Restored your last loaded problem.");
        }
      } catch (error) {
        localStorage.removeItem(storageKeys.problemSnapshot);
      }
    }
    if (!state.problem) {
      restoreDraftFor(null, state.activeLanguage, { legacyDraft: savedCode });
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
    [els.studyStatus, els.studyConfidence, els.studyMistakeCategory, els.studyReflection].forEach((control) => {
      if (control) {
        control.disabled = isBusy || !state.problem;
      }
    });
    if (els.saveStudyBtn) {
      els.saveStudyBtn.disabled = isBusy || !state.problem;
      setText(els.saveStudyBtn, isBusy ? "Saving..." : "Save learning review");
    }
    if (els.reviewQueue) {
      els.reviewQueue.querySelectorAll("button").forEach((button) => {
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
    if (!els.studyStatus) {
      return;
    }

    els.studyStatus.value = record?.status || "started";
    els.studyConfidence.value = String(record?.confidence || 3);
    els.studyMistakeCategory.value = record?.mistakeCategory || "";
    els.studyReflection.value = record?.reflection || "";
    setText(
      els.studyNextReview,
      record
        ? formatReviewDate(record.nextReviewAt, Boolean(record.due))
        : "Reach a working solution to start spaced revision."
    );
    setText(
      els.studySaveStatus,
      record?.updatedAt ? "Learning note restored for this problem." : "Add a checkpoint after your next attempt."
    );
    setStatusTone(els.studySaveStatus, "neutral");
    setStudyBusy(false);
  }

  function renderReviewQueue(queue) {
    if (!els.reviewQueue) {
      return;
    }

    els.reviewQueue.replaceChildren();
    const entries = Array.isArray(queue) ? queue : [];
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "review-queue__empty";
      const emptyTitle = document.createElement("strong");
      emptyTitle.textContent = "No revisions scheduled yet.";
      const emptyCopy = document.createElement("p");
      emptyCopy.textContent = "Save a solved checkpoint to add one.";
      empty.append(emptyTitle, emptyCopy);
      els.reviewQueue.appendChild(empty);
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
      els.reviewQueue.appendChild(item);
    });

    if (entries.length > 8) {
      const remaining = document.createElement("p");
      remaining.className = "review-queue__more";
      remaining.textContent = `${entries.length - 8} more scheduled. Finish the earliest reviews first.`;
      els.reviewQueue.appendChild(remaining);
    }
  }

  async function loadStudyData(problemSlug) {
    if (!els.reviewQueue || !els.studyStatus) {
      return;
    }

    const loadVersion = ++state.studyLoadVersion;
    if (problemSlug) {
      els.studyStatus.value = "started";
      els.studyConfidence.value = "3";
      els.studyMistakeCategory.value = "";
      els.studyReflection.value = "";
      setText(els.studyNextReview, "Reach a working solution to start spaced revision.");
    }
    setText(els.studySaveStatus, "Loading learning record...");
    setStatusTone(els.studySaveStatus, "loading");
    setStudyBusy(true);
    setText(els.saveStudyBtn, "Loading...");

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
      setStatusTone(els.studySaveStatus, "error");
      setText(els.studySaveStatus, error.name === "AbortError" ? "Learning record request timed out." : error.message);
    }
  }

  async function saveStudyRecord() {
    if (!state.problem || state.studySaving) {
      setStatusTone(els.studySaveStatus, "error");
      setText(els.studySaveStatus, "Load a problem before saving a learning note.");
      return;
    }

    const problemSlug = state.problem.titleSlug;
    const requestVersion = state.studyLoadVersion;
    setStudyBusy(true);
    setStatusTone(els.studySaveStatus, "loading");
    setText(els.studySaveStatus, "Saving your checkpoint...");

    const payload = {
      action: "save",
      problemSlug,
      problemTitle: state.problem.title,
      frontendId: state.problem.questionFrontendId,
      difficulty: state.problem.difficulty,
      status: els.studyStatus.value,
      confidence: Number(els.studyConfidence.value),
      mistakeCategory: els.studyMistakeCategory.value,
      reflection: els.studyReflection.value.trim()
    };

    try {
      const data = await fetchJson("/api/study/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify(payload)
      });
      if (requestVersion !== state.studyLoadVersion || state.problem?.titleSlug !== problemSlug) {
        return;
      }
      applyStudyRecord(data.record);
      renderReviewQueue(data.queue);
      setStatusTone(els.studySaveStatus, "success");
      setText(els.studySaveStatus, "Learning checkpoint saved.");
    } catch (error) {
      if (requestVersion !== state.studyLoadVersion || state.problem?.titleSlug !== problemSlug) {
        return;
      }
      setStatusTone(els.studySaveStatus, "error");
      setText(els.studySaveStatus, error.name === "AbortError" ? "Saving timed out. Try again." : error.message);
    } finally {
      if (requestVersion === state.studyLoadVersion && state.problem?.titleSlug === problemSlug) {
        setStudyBusy(false);
      }
    }
  }

  async function markStudyReviewed(problemSlug, expectedReviewStage) {
    if (!problemSlug || state.studySaving) {
      return;
    }

    const requestVersion = state.studyLoadVersion;
    setStudyBusy(true);
    setStatusTone(els.studySaveStatus, "loading");
    setText(els.studySaveStatus, "Updating revision schedule...");
    try {
      const data = await fetchJson("/api/study/", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": getCsrfToken()
        },
        body: JSON.stringify({ action: "reviewed", problemSlug, expectedReviewStage })
      });
      if (requestVersion !== state.studyLoadVersion) {
        return;
      }
      if (state.problem?.titleSlug === problemSlug) {
        applyStudyRecord(data.record);
      }
      renderReviewQueue(data.queue);
      setStatusTone(els.studySaveStatus, "success");
      setText(els.studySaveStatus, "Review logged. The next revision is scheduled.");
    } catch (error) {
      if (requestVersion !== state.studyLoadVersion) {
        return;
      }
      setStatusTone(els.studySaveStatus, "error");
      setText(els.studySaveStatus, error.name === "AbortError" ? "Update timed out. Try again." : error.message);
    } finally {
      if (requestVersion === state.studyLoadVersion) {
        setStudyBusy(false);
      }
    }
  }

  function legacySetProblem(problem) {
    state.problem = problem;
    const tags = (problem.tags || []).join(", ");
    setText(els.problemTitle, problem.title ? `${problem.questionFrontendId}. ${problem.title}` : "Unknown problem");
    renderProblemPreview(problem);
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

  function applyProblemState(problem, options = {}) {
    const previousProblem = state.problem;
    const isDifferentProblem = previousProblem?.titleSlug !== problem?.titleSlug;
    if (isDifferentProblem && (previousProblem || els.codeInput.value)) {
      saveDraftFor(previousProblem, state.activeLanguage, els.codeInput.value);
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

    setText(els.problemTitle, problem.title ? `${problem.questionFrontendId}. ${problem.title}` : "Unknown problem");
    renderProblemPreview(problem);
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
    void loadStudyData(problem.titleSlug);
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

  function isLeetCodeReachabilityError(error) {
    const message = String(error?.message || "").toLowerCase();
    return (
      error?.statusCode === 503 ||
      message.includes("could not reach leetcode") ||
      message.includes("leetcode request failed") ||
      message.includes("check your internet connection")
    );
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
      if (isLeetCodeReachabilityError(error)) {
        setStatusTone(els.problemStatus, "warning");
        setText(els.problemStatus, "LeetCode daily is not reachable right now. Enter a problem number or slug above and load it manually.");
      } else {
        setStatusTone(els.problemStatus, "error");
        setText(els.problemStatus, error.name === "AbortError" ? "Daily problem request timed out." : error.message);
      }
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
      const data = await fetchJson(
        "/api/assistant/",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": getCsrfToken()
          },
          body: JSON.stringify(payload)
        },
        75000
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
  if (els.saveStudyBtn) {
    els.saveStudyBtn.addEventListener("click", saveStudyRecord);
  }
  if (els.reviewQueue) {
    els.reviewQueue.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest("button") : null;
      if (!target) {
        return;
      }

      const loadSlug = target.getAttribute("data-study-load-slug");
      if (loadSlug) {
        els.problemIdentifier.value = loadSlug;
        saveWorkspaceSnapshot();
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
  if (els.copyOutputBtn) {
    els.copyOutputBtn.addEventListener("click", async () => {
      const text = state.lastAssistantText.trim();
      if (!text) {
        setStatusTone(els.assistantStatus, "warning");
        setText(els.assistantStatus, "There is no mentor output to copy yet.");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setStatusTone(els.assistantStatus, "success");
        setText(els.assistantStatus, "Mentor output copied.");
      } catch (error) {
        setStatusTone(els.assistantStatus, "error");
        setText(els.assistantStatus, "Clipboard access was blocked. Select the output and copy it manually.");
      }
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
    const nextLanguage = els.languageSelect.value;
    if (nextLanguage !== state.activeLanguage) {
      saveDraftFor(state.problem, state.activeLanguage, els.codeInput.value);
      state.activeLanguage = nextLanguage;
      restoreDraftFor(state.problem, state.activeLanguage);
    }
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
      return;
    }

    if (event.key === "Tab" && isResponsePopoverOpen()) {
      const focusable = Array.from(
        els.mentorResponsePanel.querySelectorAll("button:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])")
      ).filter((element) => !element.hasAttribute("hidden"));
      if (focusable.length) {
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (document.activeElement === els.mentorResponsePanel) {
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
  setContextTab("statement");
  restoreWorkspaceSnapshot();
  if (!state.problem) {
    void loadStudyData(null);
  }
  updateEditorFilename();
  updateServerChip("Server ready", "success");
  setStatusTone(els.problemStatus, "neutral");
  setStatusTone(els.assistantStatus, "neutral");
  setResponsePopoverOpen(false);
  renderAssistantOutput("Your explanation, hint, code review, or dry run will appear here.");
})();
