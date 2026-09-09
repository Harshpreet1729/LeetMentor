// Request AI guidance, show the response dialog, and open external help.
import {
  state,
  elements,
  setText,
  setHidden,
  setStatusTone,
  setBusy
} from "./workspace.js?v=20260910-readability";
import { renderAssistantOutput } from "./rendering.js?v=20260910-readability";
import { runWithWakeRetry, postJson } from "./api.js?v=20260910-readability";

if (elements.mentorResponseBackdrop && elements.mentorResponseBackdrop.parentElement !== document.body) {
  document.body.appendChild(elements.mentorResponseBackdrop);
}
if (elements.mentorResponsePanel && elements.mentorResponsePanel.parentElement !== document.body) {
  document.body.appendChild(elements.mentorResponsePanel);
}

export function isResponsePopoverOpen() {
  return document.body.classList.contains("mentor-response-is-open");
}

export function setResponsePopoverOpen(isOpen, options = {}) {
  if (!elements.mentorResponsePanel) {
    return;
  }

  const wasOpen = isResponsePopoverOpen();
  if (isOpen && !wasOpen) {
    state.responseTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }

  document.body.classList.toggle("mentor-response-is-open", isOpen);
  setHidden(elements.closeOutputBtn, !isOpen);
  elements.mentorResponsePanel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  if (elements.mentorResponseBackdrop) {
    elements.mentorResponseBackdrop.setAttribute("aria-hidden", isOpen ? "false" : "true");
  }

  if (isOpen) {
    window.requestAnimationFrame(() => {
      if (elements.assistantOutput) {
        elements.assistantOutput.scrollTop = 0;
      }
      if (options.focusPanel) {
        elements.mentorResponsePanel.focus({ preventScroll: true });
      }
    });
  } else if (wasOpen && state.responseTrigger) {
    const trigger = state.responseTrigger;
    state.responseTrigger = null;
    window.requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
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

  if (elements.codeInput.value.trim()) {
    pieces.push("", `My current ${elements.languageSelect.value} code:`, "```", elements.codeInput.value.trim(), "```");
  }

  if (elements.questionInput && elements.questionInput.value.trim()) {
    pieces.push("", `What I want help with: ${elements.questionInput.value.trim()}`);
  }

  return pieces.join("\n");
}

export async function openChatGptWithProblem() {
  if (!state.problem) {
    setStatusTone(elements.assistantStatus, "error");
    setText(elements.assistantStatus, "Load a problem first so there is something to send.");
    return;
  }

  const prompt = buildChatGptPrompt();
  const quickPrompt = `Give me the solution of ${state.problem.questionFrontendId}. ${state.problem.title} on LeetCode.`;
  const chatGptUrl = `https://chatgpt.com/?q=${encodeURIComponent(quickPrompt)}`;

  try {
    await navigator.clipboard.writeText(prompt);
    setStatusTone(elements.assistantStatus, "success");
    setText(elements.assistantStatus, "ChatGPT opened with a prompt, and the full problem was copied.");
    setText(elements.nextStep, "Next step: if the prompt box is empty, paste the copied problem with Ctrl+V.");
    elements.nextStep.classList.remove("hidden");
  } catch (error) {
    setStatusTone(elements.assistantStatus, "warning");
    setText(elements.assistantStatus, "ChatGPT opened with a prompt, but clipboard copy was blocked by the browser.");
    setText(elements.nextStep, "Next step: if you need more context than the title prompt, copy the problem manually.");
    elements.nextStep.classList.remove("hidden");
  }

  window.open(chatGptUrl, "_blank", "noopener,noreferrer");
}

export function openYouTubeWithProblem() {
  if (!state.problem) {
    setStatusTone(elements.assistantStatus, "error");
    setText(elements.assistantStatus, "Load a problem first so the YouTube search knows what to look for.");
    return;
  }

  const searchTitle = state.problem.title ? `leetcode ${state.problem.title} solution` : `leetcode ${state.problem.questionFrontendId} solution`;
  const youtubeUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchTitle)}`;

  setStatusTone(elements.assistantStatus, "success");
  setText(elements.assistantStatus, "YouTube search opened in a new tab.");
  setText(elements.nextStep, "Next step: pick a walkthrough that matches your language and only use it after you try your own idea.");
  elements.nextStep.classList.remove("hidden");

  window.open(youtubeUrl, "_blank", "noopener,noreferrer");
}

export async function runAssistant(mode) {
  if (state.loading) {
    return;
  }

  if (!state.problem) {
    setStatusTone(elements.assistantStatus, "error");
    setText(elements.assistantStatus, "Load a problem first so the mentor has context.");
    return;
  }

  const payload = {
    mode,
    problem: state.problem,
    userCode: elements.codeInput.value.trim(),
    language: elements.languageSelect.value,
    userQuestion: elements.questionInput ? elements.questionInput.value.trim() : "",
    hintLevel: Number(elements.hintLevelSelect.value)
  };

  if (mode === "debug" && !payload.userCode) {
    setResponsePopoverOpen(true, { focusPanel: true });
    setStatusTone(elements.assistantStatus, "error");
    setText(elements.assistantStatus, "Add your code first so the mentor can review the actual solution.");
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
  setStatusTone(elements.assistantStatus, "loading");
  setText(elements.assistantStatus, "Thinking...");
  elements.assistantOutput.innerHTML = '<div class="response-skeleton"><span></span><span></span><span></span></div>';
  elements.nextStep.classList.add("hidden");

  try {
    const data = await runWithWakeRetry(
      () => postJson("/api/assistant/", payload, 75000),
      {
        onWakeStart: () => {
          setStatusTone(elements.assistantStatus, "loading");
          setText(elements.assistantStatus, "Server was unavailable. Waking it up and retrying your request...");
        },
        onRetry: () => {
          setText(elements.assistantStatus, "Server is ready. Retrying your request...");
        }
      }
    );

    renderAssistantOutput(data.answer);
    setStatusTone(elements.assistantStatus, "success");
    setText(elements.assistantStatus, "Ready.");
    if (data.suggestedNextStep) {
      setText(elements.nextStep, `Next step: ${data.suggestedNextStep}`);
      elements.nextStep.classList.remove("hidden");
    }
  } catch (error) {
    setStatusTone(elements.assistantStatus, "error");
    setText(elements.assistantStatus, error.name === "AbortError" ? "The mentor took too long. Try again." : error.message);
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
