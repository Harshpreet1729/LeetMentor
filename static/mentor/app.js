(function () {
  const state = {
    problem: null,
    activeMode: "hint",
    loading: false
  };

  const byId = (id) => document.getElementById(id);
  const els = {
    problemIdentifier: byId("problemIdentifier"),
    problemStatus: byId("problemStatus"),
    dailyBtn: byId("dailyBtn"),
    loadProblemBtn: byId("loadProblemBtn"),
    difficultyBadge: byId("difficultyBadge"),
    problemTitle: byId("problemTitle"),
    problemLink: byId("problemLink"),
    problemStatement: byId("problemStatement"),
    problemExamples: byId("problemExamples"),
    problemConstraints: byId("problemConstraints"),
    tagList: byId("tagList"),
    codeInput: byId("codeInput"),
    editorFilename: byId("editorFilename"),
    languageSelect: byId("languageSelect"),
    hintLevelSelect: byId("hintLevelSelect"),
    questionInput: byId("questionInput"),
    assistantStatus: byId("assistantStatus"),
    assistantOutput: byId("assistantOutput"),
    nextStep: byId("nextStep"),
    askChatgptBtn: byId("askChatgptBtn"),
    clearOutputBtn: byId("clearOutputBtn"),
    modeButtons: Array.from(document.querySelectorAll("[data-mode]"))
  };

  function setText(element, text) {
    element.textContent = text;
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
    const source = String(text || "").trim();
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

    if (els.questionInput.value.trim()) {
      pieces.push("", `What I want help with: ${els.questionInput.value.trim()}`);
    }

    return pieces.join("\n");
  }

  async function openChatGptWithProblem() {
    if (!state.problem) {
      setText(els.assistantStatus, "Load a problem first so there is something to send.");
      return;
    }

    const prompt = buildChatGptPrompt();

    try {
      await navigator.clipboard.writeText(prompt);
      setText(els.assistantStatus, "Problem copied. ChatGPT opened in a new tab.");
      setText(els.nextStep, "Next step: paste with Ctrl+V in ChatGPT, then press Enter.");
      els.nextStep.classList.remove("hidden");
    } catch (error) {
      setText(els.assistantStatus, "ChatGPT opened, but clipboard copy was blocked by the browser.");
      setText(els.nextStep, "Next step: copy the problem manually and paste it into ChatGPT.");
      els.nextStep.classList.remove("hidden");
    }

    window.open("https://chatgpt.com/", "_blank", "noopener,noreferrer");
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

  function setProblem(problem) {
    state.problem = problem;
    setText(els.problemTitle, problem.title ? `${problem.questionFrontendId}. ${problem.title}` : "Unknown problem");
    setText(els.problemStatement, problem.statement || "No statement available.");
    renderProblemExamples(problem.exampleCards, problem.examples);
    renderProblemConstraints(problem.constraints);

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

  function setBusy(isBusy, label) {
    state.loading = isBusy;
    els.modeButtons.forEach((button) => {
      button.disabled = isBusy;
      if (isBusy && button.getAttribute("data-mode") === state.activeMode) {
        button.dataset.originalLabel = button.textContent;
        button.textContent = label;
      } else if (!isBusy && button.dataset.originalLabel) {
        button.textContent = button.dataset.originalLabel;
        delete button.dataset.originalLabel;
      }
    });

    els.loadProblemBtn.disabled = isBusy;
    els.dailyBtn.disabled = isBusy;
    if (els.askChatgptBtn) {
      els.askChatgptBtn.disabled = isBusy;
    }
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
        throw new Error(text.startsWith("<!DOCTYPE") ? "The server returned an HTML error page instead of JSON." : text || "Request failed.");
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.message || "Request failed.");
      }

      return data;
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function loadDaily() {
    if (state.loading) {
      return;
    }

    setBusy(true, "Loading...");
    setText(els.problemStatus, "Loading today's daily challenge...");

    try {
      const data = await fetchJson("/api/daily/");
      setProblem(data.problem);
      setText(els.problemStatus, "Daily challenge loaded.");
    } catch (error) {
      setText(els.problemStatus, error.name === "AbortError" ? "Daily problem request timed out." : error.message);
    } finally {
      setBusy(false, "Working...");
    }
  }

  async function loadProblem() {
    if (state.loading) {
      return;
    }

    const identifier = els.problemIdentifier.value.trim();
    if (!identifier) {
      setText(els.problemStatus, "Enter a problem number, slug, title, or URL first.");
      return;
    }

    setBusy(true, "Loading...");
    setText(els.problemStatus, "Looking up problem...");

    try {
      const data = await fetchJson(`/api/problem/?identifier=${encodeURIComponent(identifier)}`);
      setProblem(data.problem);
      setText(els.problemStatus, "Problem loaded.");
    } catch (error) {
      setText(els.problemStatus, error.name === "AbortError" ? "Problem lookup timed out." : error.message);
    } finally {
      setBusy(false, "Working...");
    }
  }

  async function runAssistant(mode) {
    if (state.loading) {
      return;
    }

    if (!state.problem) {
      setText(els.assistantStatus, "Load a problem first so the mentor has context.");
      return;
    }

    const payload = {
      mode,
      problem: state.problem,
      userCode: els.codeInput.value.trim(),
      language: els.languageSelect.value,
      userQuestion: els.questionInput.value.trim(),
      hintLevel: Number(els.hintLevelSelect.value)
    };

    if (mode === "debug" && !payload.userCode) {
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

    setBusy(true, "Thinking...");
    setText(els.assistantStatus, "Thinking...");
    els.assistantOutput.innerHTML = "";
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
        30000
      );

      renderAssistantOutput(data.answer);
      setText(els.assistantStatus, "Ready.");
      if (data.suggestedNextStep) {
        setText(els.nextStep, `Next step: ${data.suggestedNextStep}`);
        els.nextStep.classList.remove("hidden");
      }
    } catch (error) {
      setText(els.assistantStatus, error.name === "AbortError" ? "The mentor took too long. Try again." : error.message);
      renderAssistantOutput([
        "### Request failed",
        error.name === "AbortError"
          ? "The mentor response timed out. Try the same action once more."
          : String(error.message || "The request failed."),
      ].join("\n\n"));
    } finally {
      setBusy(false, "Thinking...");
    }
  }

  els.modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const mode = button.getAttribute("data-mode");
      setActiveMode(mode);
      runAssistant(mode);
    });
  });

  els.dailyBtn.addEventListener("click", loadDaily);
  els.loadProblemBtn.addEventListener("click", loadProblem);
  if (els.askChatgptBtn) {
    els.askChatgptBtn.addEventListener("click", openChatGptWithProblem);
  }
  els.clearOutputBtn.addEventListener("click", () => {
    setText(els.assistantStatus, "Output cleared.");
    renderAssistantOutput("Your explanation, hint, code review, or dry run will appear here.");
    setText(els.nextStep, "");
    els.nextStep.classList.add("hidden");
  });

  els.problemIdentifier.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      loadProblem();
    }
  });

  els.languageSelect.addEventListener("change", updateEditorFilename);

  setActiveMode("hint");
  updateEditorFilename();
  renderAssistantOutput("Your explanation, hint, code review, or dry run will appear here.");
})();
