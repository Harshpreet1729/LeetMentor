import React from "react";
import { createRoot } from "react-dom/client";
import { fetchDailyChallenge } from "./lib/api";
import { getPreferences } from "./lib/storage";
import type { ProblemContext, UserPreferences } from "@leetcode-assistant/shared";
import "./styles.css";

interface CurrentTabState {
  isProblemPage: boolean;
  problem: ProblemContext | null;
  tabId: number | null;
}

async function getLikelyActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [lastFocused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (lastFocused?.id) {
    return lastFocused;
  }

  const [currentWindow] = await chrome.tabs.query({ active: true, currentWindow: true });
  return currentWindow;
}

function PopupApp() {
  const [dailyProblem, setDailyProblem] = React.useState<ProblemContext | null>(null);
  const [preferences, setPreferences] = React.useState<UserPreferences | null>(null);
  const [error, setError] = React.useState("");
  const [assistantStatus, setAssistantStatus] = React.useState("");
  const [currentTabState, setCurrentTabState] = React.useState<CurrentTabState>({
    isProblemPage: false,
    problem: null,
    tabId: null
  });

  React.useEffect(() => {
    fetchDailyChallenge()
      .then(setDailyProblem)
      .catch((caughtError) => setError(caughtError instanceof Error ? caughtError.message : "Failed to load daily challenge."));
    getPreferences().then(setPreferences).catch(() => undefined);
    loadCurrentTabContext().catch(() => undefined);
  }, []);

  async function loadCurrentTabContext() {
    const tab = await getLikelyActiveTab();
    const tabId = tab?.id ?? null;

    if (!tabId) {
      return;
    }

    try {
      const response = (await chrome.tabs.sendMessage(tabId, {
        type: "leetcode-assistant:get-problem"
      })) as { ok: boolean; isProblemPage: boolean; problem: ProblemContext | null };

      setCurrentTabState({
        isProblemPage: response?.isProblemPage ?? false,
        problem: response?.problem ?? null,
        tabId
      });
    } catch {
      const url = tab?.url ?? "";
      const looksLikeProblemPage = /^https:\/\/leetcode\.com\/problems\//.test(url);

      if (looksLikeProblemPage) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ["assets/contentScript.js"]
          });

          await new Promise((resolve) => window.setTimeout(resolve, 500));

          const retryResponse = (await chrome.tabs.sendMessage(tabId, {
            type: "leetcode-assistant:get-problem"
          })) as { ok: boolean; isProblemPage: boolean; problem: ProblemContext | null };

          setCurrentTabState({
            isProblemPage: retryResponse?.isProblemPage ?? true,
            problem: retryResponse?.problem ?? null,
            tabId
          });
          return;
        } catch {
          setCurrentTabState({
            isProblemPage: true,
            problem: null,
            tabId
          });
          return;
        }
      }

      setCurrentTabState({
        isProblemPage: false,
        problem: null,
        tabId
      });
    }
  }

  async function openAssistant() {
    if (!currentTabState.tabId) {
      setAssistantStatus("Could not find the active tab.");
      return;
    }

    try {
      await chrome.tabs.sendMessage(currentTabState.tabId, {
        type: "leetcode-assistant:toggle-sidebar",
        open: true
      });
      window.close();
    } catch {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: currentTabState.tabId },
          files: ["assets/contentScript.js"]
        });
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        await chrome.tabs.sendMessage(currentTabState.tabId, {
          type: "leetcode-assistant:toggle-sidebar",
          open: true
        });
        window.close();
      } catch {
        setAssistantStatus("The page assistant did not attach yet. Refresh the LeetCode tab once and try again.");
      }
    }
  }

  return (
    <div className="assistant-gradient assistant-shell min-h-screen w-[380px] p-5">
      <p className="assistant-section-label">LeetCode Mentor</p>
      <h1 className="mt-2 text-3xl font-semibold text-slate-50">Open the page assistant fast</h1>
      <p className="assistant-muted mt-2 text-sm">Use this popup as a launchpad, then work from the richer sidebar on the problem page.</p>

      <div className="assistant-card mt-5 p-5">
        <p className="assistant-section-label">Current Tab</p>
        {currentTabState.problem ? (
          <>
            <h2 className="mt-3 text-2xl font-semibold text-slate-50">
              {currentTabState.problem.questionFrontendId ? `${currentTabState.problem.questionFrontendId}. ` : ""}
              {currentTabState.problem.title}
            </h2>
            <p className="assistant-muted mt-3 text-sm leading-6">
              The guided actions live in the page sidebar. Open it and this popup will close so the two surfaces do not overlap.
            </p>
            <button
              type="button"
              onClick={openAssistant}
              className="assistant-primary-btn mt-5 w-full"
            >
              Open Assistant Sidebar
            </button>
          </>
        ) : (
          <p className="assistant-muted mt-3 text-sm leading-6">
            {currentTabState.isProblemPage
              ? "This is a LeetCode problem tab, but the page content has not been extracted yet. Wait a moment and reopen the popup."
              : "Open any LeetCode problem page first. The chat buttons live inside the in-page assistant sidebar."}
          </p>
        )}
        {assistantStatus ? <p className="mt-3 text-sm text-amber-300">{assistantStatus}</p> : null}
      </div>

      <div className="assistant-card mt-5 p-5">
        <p className="assistant-section-label">Today's Daily Challenge</p>
        {error ? <p className="mt-3 text-sm text-red-300">{error}</p> : null}
        {dailyProblem ? (
          <>
            <h2 className="mt-3 text-xl font-semibold text-slate-50">
              {dailyProblem.questionFrontendId}. {dailyProblem.title}
            </h2>
            <p className="mt-2 text-sm text-emerald-200">{dailyProblem.difficulty}</p>
            <a className="mt-4 inline-block text-sm text-emerald-300 underline decoration-emerald-500/40 underline-offset-4" href={dailyProblem.link} target="_blank" rel="noreferrer">
              Solve on LeetCode
            </a>
          </>
        ) : !error ? (
          <p className="assistant-muted mt-3 text-sm">Loading daily challenge...</p>
        ) : null}
      </div>

      <div className="assistant-card mt-5 p-5">
        <p className="assistant-section-label">Current Preferences</p>
        <p className="mt-3 text-sm text-slate-300">Language: {preferences?.language ?? "C++"}</p>
        <p className="mt-1 text-sm text-slate-300">Theme: {preferences?.theme ?? "system"}</p>
        <p className="mt-1 text-sm text-slate-300">Model: {preferences?.model ?? "llama-3.3-70b-versatile"}</p>
        <button
          type="button"
          onClick={() => chrome.runtime.openOptionsPage()}
          className="assistant-secondary-btn mt-5 w-full"
        >
          Open Dashboard
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<PopupApp />);
