import { Bell } from "lucide-react";
import Link from "next/link";
import { StatusDot } from "@/components/status-dot";
import type { AttentionItem } from "@/lib/warnings";

/** Compact alert rows: a state dot, one line of text, and where to resolve it. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center">
        <Bell aria-hidden className="size-5 text-muted-foreground" />
        <p className="text-body-sm text-muted-foreground">Nothing needs attention</p>
      </div>
    );
  }
  return (
    <ul className="flex flex-col divide-y divide-border">
      {items.map((item, i) => (
        <li key={i} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
          <div className="flex items-start gap-2">
            <StatusDot tone={item.tone} className="mt-1.5" />
            <span className="sr-only">{item.tone === "negative" ? "Action needed:" : "Note:"}</span>
            <p className="min-w-0 text-body-sm">{item.text}</p>
          </div>
          <Link href={item.href} className="ml-4 w-fit text-caption text-link hover:underline">
            {item.linkLabel} <span aria-hidden>→</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
