import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  /** One line under the value: what it covers, or a delta. */
  caption?: ReactNode;
  /** The one headline number on the page: tinted surface, larger figure. */
  featured?: boolean;
  /** Where the corner arrow leads, and what it says to screen readers. */
  href: string;
  hrefLabel: string;
  className?: string;
}

export function KpiCard({ label, value, caption, featured = false, href, hrefLabel, className }: KpiCardProps) {
  return (
    <section
      aria-label={label}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md border p-5 shadow-subtle",
        featured ? "border-highlight-border bg-highlight" : "bg-card",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <h2
          className={cn(
            "font-sans text-caption font-medium uppercase",
            featured ? "text-highlight-foreground" : "text-muted-foreground",
          )}
        >
          {label}
        </h2>
        <Link
          href={href}
          aria-label={hrefLabel}
          title={hrefLabel}
          className={cn(
            "-mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-sm border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
            featured ? "border-highlight-border" : "border-border",
          )}
        >
          <ArrowUpRight aria-hidden className="size-4" />
        </Link>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <p
          className={cn(
            "truncate font-display font-semibold tabular-nums text-foreground",
            featured ? "text-heading" : "text-heading-sm",
          )}
        >
          {value}
        </p>
        {caption ? <div className="text-caption text-muted-foreground">{caption}</div> : null}
      </div>
    </section>
  );
}
