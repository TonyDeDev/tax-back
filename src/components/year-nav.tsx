import Link from "next/link";
import { cn } from "@/lib/utils";

/** Tabs for the years a page has, linking to `<basePath>/<year>`. */
export function YearNav({ years, current, basePath }: { years: number[]; current: number; basePath: string }) {
  return (
    <nav aria-label="Tax year" className="flex flex-wrap gap-1">
      {years.map((y) => (
        <Link
          key={y}
          href={`${basePath}/${y}`}
          aria-current={y === current ? "page" : undefined}
          className={cn(
            "rounded-sm px-3 py-1.5 text-body-sm font-medium tabular-nums transition-colors",
            y === current ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent",
          )}
        >
          {y}
        </Link>
      ))}
    </nav>
  );
}
