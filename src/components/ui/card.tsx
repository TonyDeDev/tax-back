import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/**
 * A clickable card or row moves one step up the surface ladder on hover (Graphite to Obsidian) with a
 * lighter border. No movement and no shadow.
 */
export const interactiveSurfaceClass = "transition-motion hover:border-border-strong hover:bg-surface-hover";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-md border bg-card text-card-foreground shadow-subtle", className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 p-4 md:p-6", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("font-display text-subheading font-medium", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-body-sm text-muted-foreground", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0 md:p-6 md:pt-0", className)} {...props} />;
}
