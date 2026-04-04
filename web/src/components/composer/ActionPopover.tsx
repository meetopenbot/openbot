import { useRef, useEffect } from "react";

interface ActionPopoverProps {
  showActionPopover: boolean;
  setShowActionPopover: (show: boolean) => void;
  onAttachImage: () => void;
}

export function ActionPopover({
  showActionPopover,
  setShowActionPopover,
  onAttachImage,
}: ActionPopoverProps) {
  const actionPopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!actionPopoverRef.current) return;
      if (actionPopoverRef.current.contains(event.target as Node)) return;
      setShowActionPopover(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowActionPopover(false);
    };

    if (showActionPopover) {
      window.addEventListener("mousedown", handlePointerDown);
      window.addEventListener("keydown", handleEscape);
    }
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [showActionPopover, setShowActionPopover]);

  return (
    <div ref={actionPopoverRef} className="relative flex items-center">
      <button
        type="button"
        onClick={() => setShowActionPopover(!showActionPopover)}
        className="rounded-md p-1.5 text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
        aria-label="Open actions"
        title="Open actions"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14" />
          <path d="M5 12h14" />
        </svg>
      </button>
      {showActionPopover && (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-20 w-44 overflow-hidden rounded-xl border border-border/60 bg-background p-1.5 shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <button
            type="button"
            onClick={onAttachImage}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-muted/50"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <path d="m21 15-5-5L5 21" />
            </svg>
            <span>Upload image</span>
          </button>
        </div>
      )}
    </div>
  );
}
