import type { ChatMessage } from "@leetcode-assistant/shared";

interface ChatMessageBubbleProps {
  message: ChatMessage;
}

function renderContent(content: string) {
  return content.split("\n").map((line, index) => (
    <p key={`${index}-${line}`} className="whitespace-pre-wrap">
      {line}
    </p>
  ));
}

export function ChatMessageBubble({ message }: ChatMessageBubbleProps) {
  const isAssistant = message.role === "assistant";
  return (
    <div
      className={`rounded-3xl border px-4 py-3 text-sm leading-6 ${
        isAssistant
          ? "border-white/10 bg-white/[0.04] text-slate-100"
          : "border-emerald-400/15 bg-emerald-400/10 text-emerald-50"
      }`}
    >
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{isAssistant ? "Mentor" : "You"}</p>
      <div className="space-y-1">{renderContent(message.content)}</div>
    </div>
  );
}
