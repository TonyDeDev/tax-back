"use client";

import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/** --ease-in-out in theme.css; Web Animations take the curve itself, not a CSS variable. */
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where each group's indicator last sat, relative to its `[data-indicator-group]` container. */
const last = new Map<string, Box>();

function measure(el: HTMLElement): Box {
  const rect = el.getBoundingClientRect();
  const origin = el.closest("[data-indicator-group]")?.getBoundingClientRect() ?? { left: 0, top: 0 };
  return { x: rect.left - origin.left, y: rect.top - origin.top, w: rect.width, h: rect.height };
}

/**
 * The highlight behind the active item of a nav, tab set or toggle group. Render it inside the active
 * item only (which must be `relative`), inside a container marked `data-indicator-group`. It is in the
 * server HTML, so the active state shows before hydration; when the active item changes, the new
 * indicator starts where the old one was and slides into place (200ms, ease-in-out, transform only).
 */
export function ActiveIndicator({ group, className }: { group: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const to = measure(el);
    const from = last.get(group);
    last.set(group, to);
    if (!from || !to.w || !to.h) return;
    if (from.x === to.x && from.y === to.y && from.w === to.w && from.h === to.h) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.animate(
      [
        {
          transformOrigin: "top left",
          transform: `translate(${from.x - to.x}px, ${from.y - to.y}px) scale(${from.w / to.w}, ${from.h / to.h})`,
        },
        { transformOrigin: "top left", transform: "none" },
      ],
      { duration: 200, easing: EASE_IN_OUT },
    );
  }, [group]);

  return <span ref={ref} aria-hidden className={cn("pointer-events-none absolute inset-0 -z-10", className)} />;
}
