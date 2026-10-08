"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the visitor asked for less motion. The server renders as reduced, so nothing animates before hydration decides. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => true,
  );
}

/** Reads a duration token such as `--motion-base` ("200ms") in milliseconds. */
export function motionMs(token: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const ms = Number.parseFloat(raw);
  return Number.isFinite(ms) ? ms : fallback;
}
