"use client";

import { Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AMOUNTS_COOKIE, AMOUNTS_HIDDEN, AMOUNTS_SHOWN } from "@/lib/amounts";
import { Button } from "@/components/ui/button";

/*
 * "Hide amounts": a per-visitor privacy toggle, the way a password field hides what you typed.
 *
 * The context is seeded from the cookie the server already read, then held here so a click masks
 * every client-rendered figure at once. The cookie write plus `router.refresh()` brings the
 * server-rendered ones along, including the money inside `aria-label` text.
 *
 * Charts keep their shapes on purpose: this hides the figures, not the picture. A donut still shows
 * how a portfolio is split and a value chart still shows its trend.
 */

interface AmountsState {
  hidden: boolean;
  toggle: () => void;
}

const AmountsContext = createContext<AmountsState>({ hidden: false, toggle: () => {} });

/** True while the visitor has amounts hidden. Safe to call from any client component. */
export function useAmountsHidden(): boolean {
  return useContext(AmountsContext).hidden;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function AmountsProvider({ hidden: initial, children }: { hidden: boolean; children: ReactNode }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(initial);

  const toggle = useCallback(() => {
    const next = !hidden;
    setHidden(next);
    const value = next ? AMOUNTS_HIDDEN : AMOUNTS_SHOWN;
    document.cookie = `${AMOUNTS_COOKIE}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
    router.refresh();
  }, [hidden, router]);

  return <AmountsContext.Provider value={{ hidden, toggle }}>{children}</AmountsContext.Provider>;
}

export function HideAmountsToggle() {
  const { hidden, toggle } = useContext(AmountsContext);
  const label = hidden ? "Show amounts" : "Hide amounts";
  const Icon = hidden ? EyeOff : Eye;
  return (
    <Button variant="ghost" size="icon" onClick={toggle} aria-pressed={hidden} title={label}>
      <Icon aria-hidden className="size-4" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
