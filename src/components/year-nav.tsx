import Link from "next/link";
import { ActiveIndicator } from "@/components/motion/active-indicator";
import { cn } from "@/lib/utils";

/** Tabs for the years a page has, linking to `<basePath>/<year>`. */
export function YearNav({ years, current, basePath }: { years: number[]; current: number; basePath: string }) {
  return (
    <nav aria-label="Tax year" data-indicator-group className="isolate flex flex-wrap gap-1">
      {years.map((y) => (
        <Link
          key={y}
          href={`${basePath}/${y}`}
          aria-current={y === current ? "page" : undefined}
          className={cn(
            "relative rounded-sm px-3 py-1.5 text-body-sm font-medium tabular-nums transition-motion",
            y === current ? "text-accent-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {y === current && <ActiveIndicator group={`year-${basePath}`} className="rounded-sm bg-accent" />}
          {y}
        </Link>
      ))}
    </nav>
  );
}
