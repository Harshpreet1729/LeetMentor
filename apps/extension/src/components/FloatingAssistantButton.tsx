interface FloatingAssistantButtonProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function FloatingAssistantButton({ isOpen, onToggle }: FloatingAssistantButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="fixed bottom-6 right-6 z-[2147483646] flex h-16 w-16 items-center justify-center rounded-full bg-forest-700 text-white shadow-bloom transition hover:scale-105"
      aria-label={isOpen ? "Close assistant" : "Open assistant"}
    >
      <span className="text-2xl">{isOpen ? "x" : "AI"}</span>
    </button>
  );
}
