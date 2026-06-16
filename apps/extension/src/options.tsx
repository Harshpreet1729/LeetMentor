import React from "react";
import { createRoot } from "react-dom/client";
import type { ThemeMode, UserPreferences } from "@leetcode-assistant/shared";
import { SUPPORTED_LANGUAGES, THEME_OPTIONS } from "@leetcode-assistant/shared";
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
    <div className="assistant-gradient min-h-screen p-8 text-slate-900">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-forest-700">Dashboard</p>
        <h1 className="mt-1 text-4xl font-semibold">Student-friendly control panel</h1>
        <p className="mt-3 max-w-2xl text-sm text-slate-600">
          Tune the mentor experience, keep the UI calm, and control what is stored locally in your extension.
        </p>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="rounded-[28px] border border-forest-200 bg-white/90 p-6 shadow-sm">
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

              <label className="block text-sm">
                <span className="mb-1 block font-medium">Theme</span>
                <select
                  value={preferences.theme}
                  onChange={(event) => setPreferences((current) => ({ ...current, theme: event.target.value as ThemeMode }))}
                  className="w-full rounded-2xl border border-forest-200 px-3 py-2"
                >
                  {THEME_OPTIONS.map((theme) => (
                    <option key={theme} value={theme}>
                      {theme}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="mb-1 block font-medium">AI model label</span>
                <input
                  value={preferences.model}
                  onChange={(event) => setPreferences((current) => ({ ...current, model: event.target.value }))}
                  className="w-full rounded-2xl border border-forest-200 px-3 py-2"
                />
              </label>
            </div>

            <button type="button" onClick={handleSave} className="mt-5 rounded-2xl bg-forest-700 px-5 py-2.5 text-sm font-semibold text-white">
              Save settings
            </button>
          </div>

          <div className="rounded-[28px] border border-forest-200 bg-white/90 p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Privacy and local data</h2>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              The extension stores preferences and chat history locally. It sends only the problem text, your question, and your code to the backend when required.
            </p>
            <button type="button" onClick={handleClearHistory} className="mt-5 rounded-2xl border border-forest-300 px-5 py-2.5 text-sm font-semibold text-slate-700">
              Clear chat history
            </button>
          </div>
        </div>

        {savedMessage ? <p className="mt-4 text-sm font-medium text-forest-800">{savedMessage}</p> : null}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<OptionsApp />);
