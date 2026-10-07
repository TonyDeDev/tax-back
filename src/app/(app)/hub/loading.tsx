import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

function Block({ className }: { className?: string }) {
  return <div aria-hidden className={cn("rounded-md bg-muted motion-safe:animate-pulse", className)} />;
}

function CardSkeleton({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("flex flex-col gap-4 rounded-md border bg-card p-5 shadow-subtle", className)}>{children}</div>;
}

/** The Hub's layout in Obsidian blocks while its data loads, so nothing jumps when it arrives. */
export default function HubLoading() {
  return (
    <div role="status" aria-label="Loading the Hub" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="flex flex-col gap-2">
          <Block className="h-9 w-24 md:h-10" />
          <Block className="h-4 w-72 max-w-full" />
        </div>
        <div className="flex gap-3">
          <Block className="h-8 w-48" />
          <Block className="h-8 w-36" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <CardSkeleton key={i}>
            <Block className="h-3 w-24" />
            <Block className={i === 0 ? "h-10 w-40" : "h-7 w-28"} />
            <Block className="h-3 w-32" />
          </CardSkeleton>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-12">
        <CardSkeleton className="md:col-span-2 xl:col-span-5">
          <Block className="h-5 w-36" />
          <Block className="h-56 w-full" />
        </CardSkeleton>
        <CardSkeleton className="items-center xl:col-span-4">
          <Block className="h-5 w-48 self-start" />
          <Block className="size-40 rounded-full" />
          <Block className="h-16 w-full" />
        </CardSkeleton>
        <CardSkeleton className="xl:col-span-3">
          <Block className="h-5 w-32" />
          <Block className="h-40 w-full" />
        </CardSkeleton>
      </div>
      <CardSkeleton>
        <Block className="h-5 w-44" />
        <Block className="h-40 w-full" />
      </CardSkeleton>
      <span className="sr-only">Loading</span>
    </div>
  );
}
