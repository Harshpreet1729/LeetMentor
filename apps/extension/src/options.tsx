import React from "react";
import { createRoot } from "react-dom/client";
import type { UserPreferences } from "@leetcode-assistant/shared";
import { SUPPORTED_LANGUAGES } from "@leetcode-assistant/shared";
import { clearChatHistory, getPreferences, savePreferences } from "./lib/storage";
import "./styles.css";

function OptionsApp() {
  const [preferences, setPreferences] = React.useState<UserPreferences>({
    language: "C++",
    theme: "system",
    model: "llama-3.3-70b-versatile"
  });
  const [savedMessage, setSavedMessage] = React.useState("");

  React.useEffect(() => {
    getPreferences().then(setPreferences).catch(() => undefined);
  }, []);

  async function handleSave() {
    await savePreferences(preferences);
    setSavedMessage("Settings saved.");
    window.setTimeout(() => setSavedMessage(""), 2000);
  }

  async function handleClearHistory() {
    await clearChatHistory();
    setSavedMessage("Chat history cleared.");
    window.setTimeout(() => setSavedMessage(""), 2000);
  }

  return (
    <div className="assistant-gradient min-h-screen p-8 text-slate-100">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-300">Dashboard</p>
        <h1 className="mt-1 text-4xl font-semibold">Student-friendly control panel</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-300">
          Tune the mentor experience, keep the UI calm, and control what is stored locally in your extension.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-[28px] border border-forest-200 bg-white/90 p-6 text-slate-900 shadow-sm">
            <h2 className="text-lg font-semibold">Settings</h2>
            <div className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="mb-1 block font-medium">Default language</span>
                <select
                  value={preferences.language}
                  onChange={(event) => setPreferences((current) => ({ ...current, language: event.target.value as UserPreferences["language"] }))}
                  className="w-full rounded-2xl border border-forest-200 px-3 py-2"
                >
                  {SUPPORTED_LANGUAGES.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl border border-forest-100 bg-forest-50/70 p-4 text-sm leading-6 text-slate-600">
                <p><span className="font-medium text-slate-800">Appearance:</span> dark, optimized for an editor sidebar.</p>
                <p className="mt-1"><span className="font-medium text-slate-800">AI model:</span> managed by the backend so unsupported model names never reach the provider.</p>
              </div>
            </div>

            <button type="button" onClick={handleSave} className="mt-5 rounded-2xl bg-forest-700 px-5 py-2.5 text-sm font-semibold text-white">
              Save settings
            </button>
          </div>

          <div className="rounded-[28px] border border-forest-200 bg-white/90 p-6 text-slate-900 shadow-sm">
            <h2 className="text-lg font-semibold">Privacy and local data</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              The extension stores preferences and chat history locally. It sends only the problem text, your question, and your code to the backend when required.
            </p>
            <button type="button" onClick={handleClearHistory} className="mt-5 rounded-2xl border border-forest-300 px-5 py-2.5 text-sm font-semibold text-slate-700">
              Clear chat history
            </button>
          </div>
        </div>

        {savedMessage ? <p className="mt-4 text-sm font-medium text-emerald-300">{savedMessage}</p> : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
