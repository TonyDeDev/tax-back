"use client";

import { Info, TriangleAlert } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface InfoHintProps {
  /** What the hint explains, for screen readers and as the button's name: "About sync timing". */
  label: string;
  children: ReactNode;
  /** `warning` swaps the info glyph for a caution triangle, for data that may be missing or late. */
  tone?: "info" | "warning";
  /** Which edge of the trigger the bubble lines up with, so it stays on screen near a page edge. */
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * A small icon that explains something on hover, keyboard focus or tap. The text is a real tooltip
 * (`role="tooltip"`, `aria-describedby`), Escape closes it, and it fades and scales in over 200ms.
 */
export function InfoHint({ label, children, tone = "info", align = "center", className }: InfoHintProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const Icon = tone === "warning" ? TriangleAlert : Info;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    // A tap outside closes a hint opened by touch.
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <span
      ref={root}
      className={cn("relative inline-flex", className)}
      onPointerEnter={(event) => event.pointerType === "mouse" && setOpen(true)}
      onPointerLeave={(event) => event.pointerType === "mouse" && setOpen(false)}
    >
      <button
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-motion hover:text-foreground"
      >
        <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            "absolute top-full z-40 mt-1.5 w-max max-w-72 animate-pop-in rounded-md border bg-popover px-3 py-2 text-left text-caption font-normal text-popover-foreground normal-case shadow-subtle",
            align === "start" && "left-0 origin-top-left",
            align === "center" && "left-1/2 origin-top -translate-x-1/2",
            align === "end" && "right-0 origin-top-right",
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
