import Link from "next/link";
import { cn } from "@/lib/utils";

interface BrokerageFilterProps {
  brokerages: { id: string; name: string }[];
  /** The selected connection id, or null for all brokerages. */
  selected: string | null;
}

/** Narrows the Hub to one brokerage through `?brokerage=`, so the view can be linked and reloaded. */
export function BrokerageFilter({ brokerages, selected }: BrokerageFilterProps) {
  if (brokerages.length < 2) return null;
  const options = [{ id: null, name: "All" }, ...brokerages];
  return (
    <nav aria-label="Brokerage filter" className="flex flex-wrap gap-1">
      {options.map((b) => {
        const active = b.id === selected;
        return (
          <Link
            key={b.id ?? "all"}
            href={b.id ? `/hub?brokerage=${b.id}` : "/hub"}
            aria-current={active ? "page" : undefined}
            scroll={false}
            className={cn(
              "flex h-8 items-center rounded-sm border px-3 text-caption font-medium transition-colors",
              active
                ? "border-highlight-border bg-highlight text-highlight-foreground"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {b.name}
          </Link>
        );
      })}
    </nav>
  );
}
