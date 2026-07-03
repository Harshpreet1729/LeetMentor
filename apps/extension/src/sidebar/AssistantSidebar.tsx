import { useEffect, useMemo, useRef, useState } from "react";
import type { AssistantMode, ChatMessage, ProblemContext, SupportedLanguage } from "@leetcode-assistant/shared";
import { DEFAULT_LANGUAGE, HINT_LEVELS, SUPPORTED_LANGUAGES } from "@leetcode-assistant/shared";
import { askAssistant, fetchProblem, humanizeApiError } from "../lib/api";
import { ChatMessageBubble } from "../components/ChatMessageBubble";
import { ProblemCard } from "../components/ProblemCard";
import { QuickActions } from "../components/QuickActions";
import { clearChatHistory, getChatHistory, getCodeDraft, saveChatHistory, saveCodeDraft } from "../lib/storage";

interface AssistantSidebarProps {
  currentProblem: ProblemContext | null;
  liveCode: string;
  detectedLanguage: SupportedLanguage | null;
}

function createMessage(role: ChatMessage["role"], content: string, mode?: AssistantMode): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
    mode
  };
}

function defaultPromptForMode(mode: AssistantMode, hintLevel: number): string {
  switch (mode) {
    case "hint":
      return `Give me a practical level ${hintLevel} hint that tells me what to notice, what to try next, and how to check my direction.`;
    case "debug":
      return "Review my current code from the live LeetCode editor.";
    case "complexity":
      return "Analyze the time and space complexity of my current code.";
    case "dry_run":
      return "Dry run my current code on one important example.";
    case "explain":
      return "Explain the problem in simple words.";
    case "optimize":
      return "Show how to improve my current approach.";
    case "full_solution":
      return "Show the best solution with explanation.";
    default:
      return "";
  }
}

export function AssistantSidebar({ currentProblem, liveCode, detectedLanguage }: AssistantSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [useManualCode, setUseManualCode] = useState(false);
  const [lookupValue, setLookupValue] = useState("");
  const [selectedProblem, setSelectedProblem] = useState<ProblemContext | null>(currentProblem);
  const [language, setLanguage] = useState<SupportedLanguage>(DEFAULT_LANGUAGE);
  const [hintLevel, setHintLevel] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const activeProblem = useMemo(() => selectedProblem ?? currentProblem, [currentProblem, selectedProblem]);
  const messageEndRef = useRef<HTMLDivElement | null>(null);

  const effectiveCode = useMemo(() => {
    const manual = manualCode.trim();
    const synced = liveCode.trim();
    return useManualCode ? manual : synced || manual;
  }, [liveCode, manualCode, useManualCode]);

  const displayedCode = useMemo(() => {
    const source = useManualCode ? manualCode : liveCode || manualCode;
    return source || "// Open the LeetCode code editor to auto-sync code here.";
  }, [liveCode, manualCode, useManualCode]);

  const codeLines = useMemo(() => displayedCode.split("\n"), [displayedCode]);

  useEffect(() => {
    setSelectedProblem(currentProblem);
  }, [currentProblem]);

  useEffect(() => {
    if (detectedLanguage) {
      setLanguage(detectedLanguage);
    }
  }, [detectedLanguage]);

  useEffect(() => {
    if (!currentProblem?.titleSlug) {
      return;
    }

    const needsHydration = !currentProblem.statement || !currentProblem.examples.length;
    if (!needsHydration) {
      return;
    }

    fetchProblem(currentProblem.titleSlug)
      .then((problem) => setSelectedProblem(problem))
      .catch(() => undefined);
  }, [currentProblem]);

  useEffect(() => {
    getChatHistory().then(setMessages).catch(() => undefined);
  }, []);

  useEffect(() => {
    saveChatHistory(messages).catch(() => undefined);
  }, [messages]);

  useEffect(() => {
    getCodeDraft(activeProblem?.titleSlug)
      .then((draft) => setManualCode(draft))
      .catch(() => undefined);
  }, [activeProblem?.titleSlug]);

  useEffect(() => {
    saveCodeDraft(manualCode, activeProblem?.titleSlug).catch(() => undefined);
  }, [manualCode, activeProblem?.titleSlug]);

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function sendMessage(mode: AssistantMode, presetQuestion?: string, forcedHintLevel?: number) {
    const chosenHintLevel = forcedHintLevel ?? hintLevel;
    const question = (presetQuestion ?? input.trim()) || defaultPromptForMode(mode, chosenHintLevel);
    const needsCode = mode === "debug" || mode === "complexity" || mode === "optimize" || mode === "dry_run";

    if (!question && !activeProblem && mode !== "explain") {
      setError("Add a question or load a problem first.");
      return;
    }

    if (needsCode && !effectiveCode) {
      setError("I could not read code from the LeetCode editor yet. Open the code tab on the page or switch to manual override.");
      return;
    }

    setLoading(true);
    setError("");

    const userMessage = createMessage("user", question, mode);
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput("");

    try {
      const response = await askAssistant({
        mode,
        problem: activeProblem,
        userCode: needsCode ? effectiveCode : undefined,
        userQuestion: question,
        language,
        hintLevel: chosenHintLevel
      });

      setMessages([...nextMessages, createMessage("assistant", response.answer, mode)]);
    } catch (caughtError) {
      const message = humanizeApiError(caughtError, "Something went wrong.").message;
      setError(message);
      setMessages([...nextMessages, createMessage("assistant", `I hit an issue: ${message}`, mode)]);
    } finally {
      setLoading(false);
    }
  }

  async function lookupProblem() {
    if (!lookupValue.trim()) {
      return;
    }

    setLoading(true);
    setError("");
    try {
      const problem = await fetchProblem(lookupValue.trim());
      setSelectedProblem(problem);
      setMessages((previous) => [...previous, createMessage("assistant", `Loaded ${problem.title}. Ask for hints, review, or a dry run.`)]);
    } catch (caughtError) {
      setError(humanizeApiError(caughtError, "Failed to load the problem.").message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="assistant-gradient assistant-shell fixed right-0 top-0 z-[2147483645] flex h-screen w-[460px] max-w-[96vw] min-h-0 flex-col overflow-hidden border-l border-white/10 shadow-[0_30px_80px_rgba(0,0,0,0.45)]">
      <div className="border-b border-white/10 px-6 py-5">
        <p className="assistant-section-label">LeetCode Mentor</p>
        <h1 className="mt-2 text-3xl font-semibold text-slate-50">Learn without getting spoon-fed</h1>
        <p className="assistant-muted mt-2 text-sm leading-6">Hints first, reasoning always, full code only when you really want it.</p>
      </div>

      <div className="space-y-4 border-b border-white/10 px-6 py-5">
        <ProblemCard problem={activeProblem} />

        <div className="assistant-card p-4">
          <p className="text-base font-semibold text-slate-100">Load any problem</p>
          <div className="mt-3 flex gap-2">
            <input
              value={lookupValue}
              onChange={(event) => setLookupValue(event.target.value)}
              placeholder="1102, two-sum, title, or URL"
              className="assistant-field flex-1 text-sm"
            />
            <button type="button" onClick={lookupProblem} className="assistant-primary-btn text-sm">
              Load
            </button>
          </div>
        </div>

        <div className="assistant-card p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-base font-semibold text-slate-100">Live code studio</p>
              <p className="mt-1 text-xs text-slate-400">
                {useManualCode ? "Using your manual override draft." : liveCode ? "Synced from LeetCode editor automatically." : "Waiting for LeetCode editor sync."}
              </p>
            </div>
            <button type="button" onClick={() => setUseManualCode((previous) => !previous)} className="assistant-ghost-btn text-xs">
              {useManualCode ? "Use live code" : "Manual override"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-300">Language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
                className="assistant-field w-full"
              >
                {SUPPORTED_LANGUAGES.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-300">Hint level</span>
              <select
                value={hintLevel}
                onChange={(event) => setHintLevel(Number.parseInt(event.target.value, 10))}
                className="assistant-field w-full"
              >
                {HINT_LEVELS.map((level) => (
                  <option key={level.level} value={level.level}>
                    {level.level}. {level.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {useManualCode ? (
            <label className="mt-4 block text-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="block font-medium text-slate-300">Manual code override</span>
                <span className="text-xs text-slate-500">{manualCode ? `${manualCode.split("\n").length} lines saved locally` : "Draft saves automatically"}</span>
              </div>
              <textarea
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="Paste your code here only if live sync is not enough."
                className="assistant-code-field h-52 w-full resize-y"
              />
            </label>
          ) : (
            <div className="mt-4 overflow-hidden rounded-3xl border border-white/10 bg-[#050b14]">
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-slate-100">Editor snapshot</p>
                  <p className="text-xs text-slate-500">{effectiveCode ? `${codeLines.length} lines captured from LeetCode` : "No live code captured yet"}</p>
                </div>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">{language}</span>
              </div>
              <div className="assistant-scrollbar max-h-56 overflow-auto overscroll-contain">
                <pre className="m-0 grid bg-[#050b14] text-[12px] leading-6 text-emerald-100">
                  {codeLines.map((line, index) => (
                    <div key={`${index}`} className="grid grid-cols-[48px_1fr] border-b border-white/[0.03] last:border-b-0">
                      <span className="select-none border-r border-white/[0.05] px-3 py-1 text-right text-slate-500">{index + 1}</span>
                      <code className="overflow-x-auto whitespace-pre px-4 py-1">{line || " "}</code>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="assistant-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-5">
        {!messages.length ? (
          <div className="assistant-card-soft p-4 text-sm text-slate-400">
            Use `Explain Problem`, `Give Hint`, or `Review My Code`. New mentor responses will appear here automatically.
          </div>
        ) : null}
        <div className="space-y-3">
          {messages.map((message) => (
            <ChatMessageBubble key={message.id} message={message} />
          ))}
        </div>
        <div ref={messageEndRef} />
      </div>

      <div className="border-t border-white/10 bg-slate-950/40 px-6 py-5 backdrop-blur-md">
        {error ? <p className="mb-3 text-sm text-red-300">{error}</p> : null}
        <div className="mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-100">Quick actions</p>
            <span className="text-xs text-slate-500">Hint level {hintLevel}</span>
          </div>
          <QuickActions onSelect={(mode, actionHintLevel) => sendMessage(mode, "", actionHintLevel)} />
        </div>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask for a hint, dry run, code review, or full explanation."
          className="assistant-field h-28 w-full resize-none text-sm"
        />
        <div className="mt-4 flex items-end justify-between gap-3">
          <p className="max-w-[220px] text-xs leading-5 text-slate-500">Only problem text, your question, and code are sent to the backend when needed.</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={async () => {
                setMessages([]);
                await clearChatHistory();
              }}
              className="assistant-secondary-btn text-sm"
            >
              Clear chat
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => sendMessage("hint")}
              className="assistant-primary-btn min-w-[132px] text-sm"
            >
              {loading ? "Thinking..." : "Ask Mentor"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
