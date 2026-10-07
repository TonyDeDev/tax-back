"use client";

import { RefreshCw } from "lucide-react";
import { type ReactNode, useId, useState, useTransition } from "react";
import { refreshNow } from "@/app/(app)/hub/actions";
import { StatusDot, type StatusTone } from "@/components/status-dot";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SyncControlsProps {
  /** "Synced 5 min ago", computed on the server so it matches the data on screen. */
  status: string;
  tone: StatusTone;
  /** A sync started elsewhere (the first sync, the cron) is still running. */
  running?: boolean;
  /** Why Refresh is unavailable right now (the 15-minute cooldown or a running sync), or null. Omit to hide Refresh. */
  disabledReason?: string | null;
  /** Controls placed between the status and Refresh, such as the brokerage filter. */
  children?: ReactNode;
}

/** Sync state for the page header: a status dot and label, and the Refresh button when there is one. */
export function SyncControls({ status, tone, running = false, disabledReason, children }: SyncControlsProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const syncing = pending || running;

  const refresh = () =>
    startTransition(async () => {
      setError(null);
      const result = await refreshNow();
      if (!result.ok) setError(result.message);
    });

  return (
    <div className="flex flex-col gap-1 xl:items-end">
      <div className="flex flex-wrap items-center gap-3 xl:justify-end">
        <span role="status" className="flex items-center gap-2 text-caption text-muted-foreground">
          <StatusDot tone={syncing ? "neutral" : error ? "negative" : tone} pulse={syncing} />
          {pending ? "Syncing..." : status}
        </span>
        {children}
        {disabledReason !== undefined && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={refresh}
              disabled={syncing || disabledReason !== null}
              aria-busy={syncing}
              aria-describedby={disabledReason ? reasonId : undefined}
              title={disabledReason ?? undefined}
            >
              <RefreshCw aria-hidden className={cn("size-4", syncing && "motion-safe:animate-spin")} />
              Refresh
            </Button>
            {disabledReason && (
              <span id={reasonId} className="sr-only">
                {disabledReason}
              </span>
            )}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="text-caption text-negative">
          {error}
        </p>
      )}
    </div>
  );
}
