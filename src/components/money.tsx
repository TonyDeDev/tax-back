import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { directionOf, formatMoney, type NumericInput } from "@/lib/format";
import { cn } from "@/lib/utils";

interface MoneyProps {
  value: NumericInput;
  currency?: string;
  /** Show +/- and an arrow, and color gains and losses. Use for anything that is a gain or loss. */
  signed?: boolean;
  className?: string;
}

export function Money({ value, currency = "CAD", signed = false, className }: MoneyProps) {
  const text = formatMoney(value, currency, { signed });
  if (!signed) return <span className={cn("tabular-nums", className)}>{text}</span>;

  const direction = directionOf(value);
  // Zero has no sign, so it gets no arrow either: a dash-like icon would read as a negative amount.
  if (direction === "flat") return <span className={cn("tabular-nums", className)}>{text}</span>;
  const Icon = direction === "gain" ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums",
        direction === "gain" && "text-positive",
        direction === "loss" && "text-negative",
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      {text}
    </span>
  );
}
