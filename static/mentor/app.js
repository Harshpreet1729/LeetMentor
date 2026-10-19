const $ = (id) => document.getElementById(id);
let problem = null;
let language = "Python";
let busy = false;

function status(id, message, error = false) {
  $(id).textContent = message;
  $(id).classList.toggle("error", error);
}

function storage(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch {
    $("draft-status").textContent = "Browser storage is unavailable. Copy your draft before leaving.";
  }
  return null;
}

function draftKey() {
  return `leetmentor.draft.v2.${encodeURIComponent(problem?.titleSlug || "scratchpad")}.${encodeURIComponent(language)}`;
}

function updateEditor() {
  const count = $("code").value.split("\n").length;
  $("line-numbers").textContent = Array.from({length: count}, (_, i) => i + 1).join("\n");
  $("line-count").textContent = `${count} line${count === 1 ? "" : "s"}`;
}

function resetFeedback() {
  $("feedback").hidden = false;
  $("feedback-title").textContent = "Mentor feedback";
  $("answer").textContent = "Stuck on the next step? Ask for a hint, or get a second look at your code.";
  $("answer").classList.add("muted");
}

function saveDraft() {
  storage(draftKey(), $("code").value);
}

async function request(url, payload) {
  const response = await fetch(url, {
    method: payload === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRFToken": document.querySelector('meta[name="csrf-token"]').content,
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal: AbortSignal.timeout(90000),
  });
  let data;
  try { data = await response.json(); }
  catch { throw new Error("The server could not answer. Please try again."); }
  if (!response.ok || !data.ok) throw new Error(data.message || "Request failed. Please try again.");
  return data;
}

// Keep requests sequential so switching problems cannot show an old answer.
async function run(statusId, message, action) {
  if (busy) return;
  busy = true;
  document.querySelectorAll("button, select").forEach((element) => { element.disabled = true; });
  status(statusId, message);
  try { await action(); }
  catch (error) {
    status(statusId, error.name === "TimeoutError" ? "The request timed out. Please try again." : error.message, true);
  } finally {
    busy = false;
    document.querySelectorAll("button, select").forEach((element) => { element.disabled = false; });
  }
}

function showProblem(next, saved = null) {
  saveDraft();
  if (saved?.language) {
    language = saved.language;
    $("language").value = language;
    storage("leetmentor.language", language);
  }
  problem = next;
  $("problem-title").textContent = problem.title;
  $("problem-meta").textContent = problem.difficulty;
  $("problem-meta").dataset.level = problem.difficulty;
  $("problem-meta").hidden = false;
  $("problem-content").classList.remove("empty");
  $("leetcode-link").href = `https://leetcode.com/problems/${encodeURIComponent(problem.titleSlug)}/`;
  $("leetcode-link").hidden = false;
  $("problem-content").textContent = problem.statement || "Read the full statement on LeetCode.";
  for (const [index, example] of (problem.examples || []).entries()) {
    const title = document.createElement("h3");
    title.textContent = `Example ${index + 1}`;
    const text = document.createElement("pre");
    text.className = "example";
    text.textContent = example.replace(/^Example\s+\d+[:\s]*/, "");
    $("problem-content").append(title, text);
  }
  if (problem.constraints?.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Constraints";
    const list = document.createElement("ul");
    for (const constraint of problem.constraints) {
      const item = document.createElement("li");
      item.textContent = constraint;
      list.append(item);
    }
    $("problem-content").append(heading, list);
  }
  $("code").value = storage(draftKey()) ?? saved?.bestCode ?? "";
  updateEditor();
  resetFeedback();
  status("action-status", "");
  storage("leetmentor.problemSnapshot", JSON.stringify(problem));
}

function loadProblem(identifier, saved = null) {
  return run("problem-status", "Loading problem...", async () => {
    const url = identifier === null ? "/api/daily/" : `/api/problem/?identifier=${encodeURIComponent(identifier)}`;
    const data = await request(url);
    showProblem(data.problem, saved);
    status("problem-status", "Problem loaded.");
  });
}

function ask(mode) {
  return run("action-status", mode === "hint" ? "Getting a hint..." : "Reviewing your code...", async () => {
    if (!problem) throw new Error("Load a problem first.");
    if (mode === "review" && !$("code").value.trim()) throw new Error("Paste your code first.");
    $("feedback").hidden = true;
    const data = await request("/api/assistant/", {mode, problem, language, userCode: $("code").value});
    $("feedback-title").textContent = mode === "hint" ? "Hint" : "Code review";
    $("answer").textContent = data.answer;
    $("answer").classList.remove("muted");
    $("feedback").hidden = false;
    status("action-status", "");
  });
}

async function refreshHistory() {
  const data = await request("/api/history/");
  $("history-list").replaceChildren();
  status("history-status", data.solutions.length ? `${data.solutions.length} saved problem${data.solutions.length === 1 ? "" : "s"}.` : "No solved problems yet. Save your first solution above.");
  for (const saved of data.solutions) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    const title = document.createElement("strong");
    title.textContent = saved.problemTitle;
    summary.append(title);
    for (const value of [saved.difficulty, saved.language || "No code yet", new Date(saved.updatedAt).toLocaleDateString()]) {
      const cell = document.createElement("span");
      cell.textContent = value;
      summary.append(cell);
    }
    const code = document.createElement("pre");
    code.textContent = saved.bestCode || "Completed in the old tracker. Save a solution to add your best code.";
    const open = document.createElement("button");
    open.className = "secondary";
    open.textContent = "Open problem";
    open.addEventListener("click", () => {
      $("identifier").value = saved.problemSlug;
      void loadProblem(saved.problemSlug, saved);
      $("problem-title").scrollIntoView({block: "start"});
    });
    details.append(summary, code, open);
    $("history-list").append(details);
  }
}

function saveSolution() {
  return run("action-status", "Saving solution...", async () => {
    if (!problem) throw new Error("Load a problem first.");
    if (!$("code").value.trim()) throw new Error("Paste your best code before saving.");
    saveDraft();
    await request("/api/history/", {
      problemSlug: problem.titleSlug, problemTitle: problem.title,
      difficulty: problem.difficulty, language, bestCode: $("code").value,
    });
    status("action-status", "Saved as your best solution.");
    try { await refreshHistory(); }
    catch { status("history-status", "Solution saved. Refresh to reload history.", true); }
  });
}

$("problem-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void loadProblem($("identifier").value.trim());
});
$("daily-button").addEventListener("click", () => loadProblem(null));
$("hint-button").addEventListener("click", () => ask("hint"));
$("review-button").addEventListener("click", () => ask("review"));
$("save-button").addEventListener("click", saveSolution);
$("refresh-history").addEventListener("click", () => run("history-status", "Loading history...", refreshHistory));
$("code").addEventListener("input", () => { saveDraft(); updateEditor(); });
$("code").addEventListener("scroll", () => { $("line-numbers").scrollTop = $("code").scrollTop; });
$("language").addEventListener("change", () => {
  saveDraft();
  language = $("language").value;
  $("code").value = storage(draftKey()) ?? "";
  storage("leetmentor.language", language);
  updateEditor();
  resetFeedback();
});

const savedLanguage = storage("leetmentor.language");
if (["Python", "C++", "Java", "JavaScript"].includes(savedLanguage)) language = savedLanguage;
$("language").value = language;
$("code").value = storage(draftKey()) ?? storage("leetmentor.code") ?? "";
try {
  const saved = JSON.parse(storage("leetmentor.problemSnapshot"));
  if (saved && typeof saved.title === "string" && typeof saved.titleSlug === "string") {
    showProblem(saved);
    status("problem-status", "Restored your last problem.");
  }
} catch { /* A damaged old snapshot should not stop practice. */ }
updateEditor();
void run("history-status", "Loading history...", refreshHistory);
