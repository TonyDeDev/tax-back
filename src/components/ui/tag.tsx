import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** DESIGN.md Tag/Label: a small uppercase status label on the tinted highlight surface. */
export function Tag({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border border-highlight-border bg-highlight px-2 py-0.5 text-caption font-medium whitespace-nowrap text-highlight-foreground uppercase",
        className,
      )}
      {...props}
    />
  );
}
