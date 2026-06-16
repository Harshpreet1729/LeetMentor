import type { AssistantMode } from "@leetcode-assistant/shared";

const actions: Array<{ label: string; mode: AssistantMode; hintLevel?: number }> = [
  { label: "Explain Problem", mode: "explain" },
  { label: "Give Hint", mode: "hint", hintLevel: 1 },
  { label: "Review My Code", mode: "debug" },
  { label: "Analyze Complexity", mode: "complexity" },
  { label: "Optimal Solution", mode: "full_solution" },
  { label: "Dry Run", mode: "dry_run" },
  { label: "Edge Cases", mode: "optimize" }
];

interface QuickActionsProps {
  onSelect: (mode: AssistantMode, hintLevel?: number) => void;
}

export function QuickActions({ onSelect }: QuickActionsProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={() => onSelect(action.mode, action.hintLevel)}
          className="assistant-secondary-btn min-h-[48px] text-left text-sm"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
