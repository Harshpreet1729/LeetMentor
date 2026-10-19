import { useEffect, useState } from "react";
import { request } from "./api.js";
import Feedback from "./Feedback.jsx";

const LANGUAGES = ["Python", "C++", "Java", "JavaScript"];
const HINTS = {
  1: { label: "Starting hint", description: "A small nudge to get started." },
  2: { label: "Approach hint", description: "The technique and why it fits." },
  3: { label: "Algorithm hint", description: "The steps to solve it, without code." },
};

function readStorage(key) {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

function readProblem() {
  try {
    const saved = JSON.parse(readStorage("leetmentor.problemSnapshot"));
    if (typeof saved?.title !== "string" || typeof saved?.titleSlug !== "string") return null;
    if (typeof saved.statement !== "string") return null;
    for (const field of ["examples", "constraints"]) {
      if (saved[field] && (!Array.isArray(saved[field]) || saved[field].some(item => typeof item !== "string"))) return null;
    }
    return saved;
  } catch { return null; }
}

function draftKey(problem, language) {
  return `leetmentor.draft.v2.${encodeURIComponent(problem?.titleSlug || "scratchpad")}.${encodeURIComponent(language)}`;
}

function Status({ id, message }) {
  return <p id={id} className={`status${message?.error ? " error" : ""}`} role="status">{message?.text}</p>;
}

export default function App() {
  const [problem, setProblem] = useState(readProblem);
  const [language, setLanguage] = useState(() => {
    const saved = readStorage("leetmentor.language");
    return LANGUAGES.includes(saved) ? saved : "Python";
  });
  const [code, setCode] = useState(() => readStorage(draftKey(problem, language)) ?? readStorage("leetmentor.code") ?? "");
  const [hintLevel, setHintLevel] = useState(() => {
    const saved = Number(readStorage("leetmentor.hintLevel"));
    return HINTS[saved] ? saved : 1;
  });
  const [identifier, setIdentifier] = useState("");
  const [solutions, setSolutions] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState(true);
  const [storageError, setStorageError] = useState("");
  const [messages, setMessages] = useState({
    problem: { text: problem ? "Restored your last problem." : "Choose a problem to get started." },
    history: { text: "Loading history..." },
  });

  function showMessage(target, text, error = false) {
    setMessages(previous => ({ ...previous, [target]: { text, error } }));
  }

  async function refreshHistory(signal) {
    const data = await request("/api/history/", undefined, signal);
    setSolutions(data.solutions);
    showMessage("history", data.solutions.length
      ? `${data.solutions.length} saved problem${data.solutions.length === 1 ? "" : "s"}.`
      : "No solved problems yet. Save your first solution above.");
  }

  useEffect(() => {
    const controller = new AbortController();
    refreshHistory(controller.signal).catch(error => {
      if (!controller.signal.aborted) showMessage("history", error.message, true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(draftKey(problem, language), code);
      localStorage.setItem("leetmentor.language", language);
      localStorage.setItem("leetmentor.hintLevel", String(hintLevel));
      if (problem) localStorage.setItem("leetmentor.problemSnapshot", JSON.stringify(problem));
    } catch {
      setStorageError("Browser storage is unavailable. Copy your draft before leaving.");
    }
  }, [problem, language, code, hintLevel]);

  async function run(target, message, action) {
    // Disable all controls until this request ends, so old answers cannot reach a new problem.
    if (loading) return;
    setLoading(true);
    showMessage(target, message);
    try { await action(); }
    catch (error) {
      showMessage(target, error.name === "TimeoutError" ? "The request timed out. Please try again." : error.message, true);
    } finally { setLoading(false); }
  }

  function loadProblem(query, saved = null) {
    return run("problem", "Loading problem...", async () => {
      const url = query === null ? "/api/daily/" : `/api/problem/?identifier=${encodeURIComponent(query)}`;
      const data = await request(url);
      const nextLanguage = saved?.language || language;
      setProblem(data.problem);
      setLanguage(nextLanguage);
      setCode(readStorage(draftKey(data.problem, nextLanguage)) ?? saved?.bestCode ?? "");
      setFeedback(null);
      showMessage("action", "");
      showMessage("problem", "Problem loaded.");
    });
  }

  function changeLanguage(nextLanguage) {
    setLanguage(nextLanguage);
    setCode(readStorage(draftKey(problem, nextLanguage)) ?? "");
    setFeedback(null);
  }

  function ask(mode) {
    return run("action", mode === "hint" ? "Getting a hint..." : "Reviewing your code...", async () => {
      if (!problem) throw new Error("Load a problem first.");
      if (mode === "review" && !code.trim()) throw new Error("Paste your code first.");
      setFeedback(null);
      const data = await request("/api/assistant/", { mode, problem, language, hintLevel, userCode: code });
      setFeedback({ title: mode === "hint" ? `${hintLevel} · ${HINTS[hintLevel].label}` : "Code review", answer: data.answer });
      showMessage("action", "");
    });
  }

  function saveSolution() {
    return run("action", "Saving solution...", async () => {
      if (!problem) throw new Error("Load a problem first.");
      if (!code.trim()) throw new Error("Paste your best code before saving.");
      await request("/api/history/", {
        problemSlug: problem.titleSlug, problemTitle: problem.title,
        difficulty: problem.difficulty, language, bestCode: code,
      });
      showMessage("action", "Saved as your best solution.");
      try { await refreshHistory(); }
      catch { showMessage("history", "Solution saved. Refresh to reload history.", true); }
    });
  }

  const lineCount = code.split("\n").length;
  return <>
    <header className="site-header">
      <a className="brand" href="/"><img src="/static/brand/leetmentor-mark.svg" alt="" />LeetMentor</a>
      <nav aria-label="Main navigation"><a className="active" href="#workspace">Practice</a><a href="#history">Solved history</a></nav>
    </header>
    <main>
      <fieldset className="page-controls" disabled={loading} aria-busy={loading}>
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy"><h1 id="page-title">One problem at a time.</h1><p>A little guidance. A better solution.</p></div>
          <div className="loader">
            <label htmlFor="identifier">Find your next problem</label>
            <form id="problem-form" onSubmit={event => { event.preventDefault(); loadProblem(identifier.trim()); }}>
              <input id="identifier" placeholder="Number, title, or LeetCode URL" required autoComplete="off" value={identifier} onChange={event => setIdentifier(event.target.value)} />
              <button type="submit" id="load-button">Load problem</button>
              <button type="button" id="daily-button" className="secondary" onClick={() => loadProblem(null)}>Today's daily</button>
            </form>
            <Status id="problem-status" message={messages.problem} />
          </div>
        </section>
        <div id="workspace" className="workspace">
          <section className="panel problem-panel" aria-labelledby="problem-title">
            <div className="panel-top"><span className="section-label">Problem</span>
              {problem && <a id="leetcode-link" href={`https://leetcode.com/problems/${encodeURIComponent(problem.titleSlug)}/`} target="_blank" rel="noopener noreferrer">Open on LeetCode ↗</a>}
            </div>
            <div className="problem-heading"><h2 id="problem-title">{problem?.title || "Your next problem"}</h2>
              {problem && <span id="problem-meta" className="difficulty" data-level={problem.difficulty}>{problem.difficulty}</span>}
            </div>
            <div id="problem-content" className={`problem-text${problem ? "" : " empty"}`}>
              {problem ? <>{problem.statement || "Read the full statement on LeetCode."}
                {(problem.examples || []).map((example, index) => <div key={index}>
                  <h3>Example {index + 1}</h3><pre className="example">{example.replace(/^Example\s+\d+[:\s]*/, "")}</pre>
                </div>)}
                {problem.constraints?.length > 0 && <><h3>Constraints</h3><ul>{problem.constraints.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
              </> : "Load today's daily challenge or search for a problem above. Your statement, examples, and constraints will appear here."}
            </div>
          </section>
          <section className="panel solution-panel" aria-labelledby="code-title">
            <div className="panel-top"><h2 id="code-title" className="section-label">Your solution</h2>
              <label className="sr-only" htmlFor="language">Programming language</label>
              <select id="language" value={language} onChange={event => changeLanguage(event.target.value)}>{LANGUAGES.map(item => <option key={item}>{item}</option>)}</select>
            </div>
            <div className="editor">
              <div className="editor-body"><pre id="line-numbers" aria-hidden="true">{Array.from({ length: lineCount }, (_, index) => index + 1).join("\n")}</pre>
                <textarea id="code" aria-label="Your code" wrap="off" spellCheck={false} maxLength={60000} placeholder="# Write or paste your solution here" aria-describedby="draft-status"
                  value={code} onChange={event => setCode(event.target.value)} onScroll={event => { event.currentTarget.previousElementSibling.scrollTop = event.currentTarget.scrollTop; }} />
              </div>
              <div className="editor-footer"><span id="draft-status">{storageError || "Drafts are saved in this browser"}</span><span id="line-count">{lineCount} line{lineCount === 1 ? "" : "s"}</span></div>
            </div>
            <div className="hint-options"><label htmlFor="hint-level">Hint level</label>
              <select id="hint-level" aria-describedby="hint-description" value={hintLevel} onChange={event => setHintLevel(Number(event.target.value))}>
                {Object.entries(HINTS).map(([level, hint]) => <option key={level} value={level}>{level} · {hint.label}</option>)}
              </select><span id="hint-description">{HINTS[hintLevel].description}</span>
            </div>
            <div className="actions">
              <button id="hint-button" className="secondary" onClick={() => ask("hint")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 .8-1 2-1 3H9c0-1 0-2.2-1-3Z" /></svg> Get a hint</button>
              <button id="review-button" className="secondary" onClick={() => ask("review")}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7-5 5 5 5m10-10 5 5-5 5m-3-13-4 16" /></svg> Review code</button>
              <button id="save-button" onClick={saveSolution}>Save best solution</button>
            </div>
            <p className="save-note">Save marks it solved and replaces its best code. Code is not executed here.</p>
            <Status id="action-status" message={messages.action} />
            <section id="feedback" className="feedback" aria-labelledby="feedback-title">
              <h3 id="feedback-title" className="section-label">{feedback?.title || "Mentor feedback"}</h3>
              <div id="answer" className={`answer${feedback ? "" : " muted"}`}>
                {feedback ? <Feedback answer={feedback.answer} /> : "Stuck on the next step? Ask for a hint, or get a second look at your code."}
              </div>
            </section>
          </section>
        </div>
        <section id="history" className="panel history" aria-labelledby="history-title">
          <div className="panel-top"><h2 id="history-title" className="section-label">Solved history</h2><button id="refresh-history" className="secondary compact" onClick={() => run("history", "Loading history...", () => refreshHistory())}>Refresh</button></div>
          <p className="history-note">Your problems. Your best solutions. Saved for this browser session.</p>
          <Status id="history-status" message={messages.history} />
          <div className="history-columns" aria-hidden="true"><span>Problem</span><span>Difficulty</span><span>Language</span><span>Saved</span></div>
          <div id="history-list">{solutions.map(saved => <details key={saved.problemSlug}>
            <summary><strong>{saved.problemTitle}</strong><span>{saved.difficulty}</span><span>{saved.language || "No code yet"}</span><span>{new Date(saved.updatedAt).toLocaleDateString()}</span></summary>
            <pre>{saved.bestCode || "Completed in the old tracker. Save a solution to add your best code."}</pre>
            <button className="secondary" onClick={() => { setIdentifier(saved.problemSlug); loadProblem(saved.problemSlug, saved); }}>Open problem</button>
          </details>)}</div>
        </section>
      </fieldset>
    </main>
    <footer>A little progress, one problem at a time.</footer>
  </>;
}
