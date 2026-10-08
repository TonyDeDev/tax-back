import { cn } from "@/lib/utils";

/**
 * An Obsidian placeholder with a slow 1.6s shimmer. The band is a transformed pseudo-element, so
 * nothing but `transform` animates, and reduced motion leaves a still block.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-md bg-muted",
        "after:absolute after:inset-0 after:animate-shimmer after:bg-linear-to-r after:from-transparent after:via-accent after:to-transparent",
        className,
      )}
    />
  );
}
