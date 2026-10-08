"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAmountsHidden } from "@/components/amounts";
import { useReducedMotion } from "@/components/motion/use-reduced-motion";
import { directionOf, formatMoney, type NumericInput } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MoneyProps {
  value: NumericInput;
  currency?: string;
  /** Show +/- and an arrow, and color gains and losses. Use for anything that is a gain or loss. */
  signed?: boolean;
  /** Count up from zero when first shown (600ms). For headline figures such as the Hub KPIs. */
  countUp?: boolean;
  className?: string;
}

const COUNT_MS = 600;
const subscribeNever = () => () => {};

/**
 * True when this render is a client-side mount (a navigation), false while hydrating server HTML.
 * Counting up during hydration would first swap the real figure, already on screen, for zero.
 */
function useClientMount(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/** The figure on its way up from zero, or null once it has settled (or never animated). Display only. */
function useCountUp(target: number, enabled: boolean): number | null {
  const [shown, setShown] = useState<number | null>(enabled ? 0 : null);
  useEffect(() => {
    if (!enabled) return;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min((now - start) / COUNT_MS, 1);
      if (t >= 1) return setShown(null);
      setShown(target * (1 - (1 - t) ** 3));
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
    // Counts once per mount; a later change of value shows at once (and flashes when signed).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return shown;
}

export function Money({ value, currency = "CAD", signed = false, countUp = false, className }: MoneyProps) {
  const hidden = useAmountsHidden();
  const reduced = useReducedMotion();
  const clientMount = useClientMount();
  const [counting] = useState(() => countUp && clientMount && !reduced && !hidden);
  const shown = useCountUp(Number(value), counting);

  // A gain or loss that changes while on screen flashes, so the change is noticed (300ms).
  const [previous, setPrevious] = useState(value);
  const [flash, setFlash] = useState(0);
  if (previous !== value) {
    setPrevious(value);
    if (signed) setFlash((n) => n + 1);
  }

  const text = formatMoney(value, currency, { signed, hidden });
  // The final text holds the width while the count runs, so nothing beside it moves.
  const figure =
    shown === null || hidden ? (
      text
    ) : (
      <span className="inline-grid">
        <span className="invisible col-start-1 row-start-1">{text}</span>
        <span aria-hidden className="col-start-1 row-start-1">
          {formatMoney(shown, currency, { signed })}
        </span>
        <span className="sr-only">{text}</span>
      </span>
    );

  // While hidden, drop the arrow and the gain/loss color too: either would still say which way it went.
  if (!signed || hidden) return <span className={cn("tabular-nums", className)}>{figure}</span>;

  const direction = directionOf(value);
  // Zero has no sign, so it gets no arrow either: a dash-like icon would read as a negative amount.
  if (direction === "flat") return <span className={cn("tabular-nums", className)}>{figure}</span>;
  const Icon = direction === "gain" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      key={flash}
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        direction === "gain" && "text-positive",
        direction === "loss" && "text-negative",
        flash > 0 && "animate-value-flash",
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {figure}
    </span>
  );
}
