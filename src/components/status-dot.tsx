import { cn } from "@/lib/utils";

export type StatusTone = "positive" | "negative" | "neutral";

interface StatusDotProps {
  tone: StatusTone;
  /** Pulses while something is in progress, such as a sync. Static under `prefers-reduced-motion`. */
  pulse?: boolean;
  className?: string;
}

/** An 8px state signal. Decorative: always pair it with text that says the same thing. */
export function StatusDot({ tone, pulse = false, className }: StatusDotProps) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        tone === "positive" && "bg-positive",
        tone === "negative" && "bg-negative",
        tone === "neutral" && "bg-chart-3",
        pulse && "motion-safe:animate-pulse",
        className,
      )}
    />
  );
}
