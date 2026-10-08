"use client";

import { X } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "taxback.disclaimer";

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "dismissed";
  } catch {
    return false;
  }
}

/**
 * The one disclaimer: a slim strip fixed to the bottom of every page, above the phone bottom nav.
 * It appears after mount (it is fixed, so nothing shifts), slides up 8px, and reserves its height on
 * the body while shown (src/app/globals.css). Dismissal is remembered in this browser.
 */
export function DisclaimerStrip() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Read after mount: the server cannot see localStorage, and a strip that flashed in then out would be worse.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!wasDismissed()) setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    document.body.dataset.disclaimer = "";
    return () => {
      delete document.body.dataset.disclaimer;
    };
  }, [visible]);

  if (!visible) return null;

  function dismiss() {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, "dismissed");
    } catch {
      // Storage can be blocked; the strip still closes for this visit.
    }
  }

  return (
    <aside
      aria-label="Disclaimer"
      className="fixed right-0 bottom-(--strip-bottom) left-(--strip-left) z-30 flex h-(--disclaimer-h) animate-strip-in items-center border-t border-highlight-border bg-background"
    >
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 md:px-8">
        <p className="truncate text-caption text-muted-foreground">Concept demo - not tax advice</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss the disclaimer"
          className="-mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-motion hover:bg-accent hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      </div>
    </aside>
  );
}
