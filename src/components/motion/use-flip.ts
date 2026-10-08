"use client";

import { type RefObject, useLayoutEffect, useRef } from "react";

/** --ease-in-out in theme.css; Web Animations take the curve itself, not a CSS variable. */
const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";

/**
 * FLIP reordering: after `order` changes, every `[data-flip-key]` child of the container starts at its
 * old offset and slides to its new one (200ms). Offsets are layout positions, not viewport ones, so a
 * scroll between two sorts does not throw them off. Rows simply jump under reduced motion.
 */
export function useFlip(containerRef: RefObject<HTMLElement | null>, order: unknown) {
  const previous = useRef(new Map<string, number>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const items = container.querySelectorAll<HTMLElement>("[data-flip-key]");
    const next = new Map<string, number>();
    for (const el of items) next.set(el.dataset.flipKey!, el.offsetTop);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && previous.current.size > 0) {
      for (const el of items) {
        const before = previous.current.get(el.dataset.flipKey!);
        const after = next.get(el.dataset.flipKey!);
        if (before === undefined || after === undefined || before === after) continue;
        el.animate([{ transform: `translateY(${before - after}px)` }, { transform: "none" }], {
          duration: 200,
          easing: EASE_IN_OUT,
        });
      }
    }
    previous.current = next;
  }, [containerRef, order]);
}
