import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { ClaudeModelOption } from "../../hooks/useChatProviderState";

type ModelPickerProps = {
  value: string;
  options: ClaudeModelOption[];
  onChange: (value: string) => void;
};

export default function ModelPicker({ value, options, onChange }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((o) => o.value === value || o.resolvedModel === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  const openList = () => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        tabIndex={-1}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/50 py-1.5 pl-3 pr-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/20"
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          className="absolute left-1/2 top-full z-50 mt-1.5 grid max-h-80 w-max min-w-full max-w-[calc(100vw-2rem)] -translate-x-1/2 grid-cols-[auto_auto_minmax(0,1fr)] gap-x-3 overflow-y-auto rounded-xl border border-border bg-popover p-1 text-left text-popover-foreground shadow-lg"
        >
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const isActive = index === activeIndex;
            return (
              <div
                key={option.value + option.label}
                data-index={index}
                role="option"
                aria-selected={isSelected}
                onPointerEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                className={`col-span-3 grid cursor-pointer grid-cols-subgrid items-center rounded-lg px-2.5 py-2 text-sm ${isActive ? "bg-accent text-accent-foreground" : ""}`}
              >
                <Check className={`h-3.5 w-3.5 text-primary ${isSelected ? "" : "invisible"}`} />
                <span className={`whitespace-nowrap ${isSelected ? "font-semibold" : "font-medium"}`}>
                  {option.label}
                </span>
                <span className="text-muted-foreground sm:whitespace-nowrap">{option.description}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
