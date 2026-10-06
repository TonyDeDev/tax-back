"use client";

import { RefreshCw } from "lucide-react";
import { useState, useTransition } from "react";
import { refreshNow } from "@/app/(app)/hub/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RefreshButtonProps {
  /** "Synced 5 min ago", computed on the server so it matches the data on screen. */
  status: string;
  /** Why Refresh is unavailable right now (the 15-minute cooldown or a running sync), or null. */
  disabledReason: string | null;
}

export function RefreshButton({ status, disabledReason }: RefreshButtonProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    startTransition(async () => {
      setError(null);
      const result = await refreshNow();
      if (!result.ok) setError(result.message);
    });

  return (
    <div className="flex flex-col gap-1 sm:items-end">
      <div className="flex items-center gap-3">
        <span className="text-caption text-muted-foreground">{pending ? "Syncing..." : status}</span>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={pending || disabledReason !== null}
          aria-busy={pending}
          title={disabledReason ?? undefined}
        >
          <RefreshCw aria-hidden className={cn("size-4", pending && "animate-spin")} />
          Refresh
        </Button>
      </div>
      {(error ?? disabledReason) && (
        <p role={error ? "alert" : undefined} className={cn("text-caption", error ? "text-negative" : "text-muted-foreground")}>
          {error ?? disabledReason}
        </p>
      )}
    </div>
  );
}
