"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";
import { firstSync } from "@/app/(app)/hub/actions";
import { Button } from "@/components/ui/button";

/**
 * Starts the first read right after SnapTrade access is granted, so the slow work stays out of the
 * OAuth callback and the user sees progress. The server action re-renders the page when it finishes.
 */
export function FirstSync() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  const run = () =>
    startTransition(async () => {
      setError(null);
      const result = await firstSync();
      if (!result.ok) setError(result.message);
    });

  useEffect(() => {
    // Strict Mode mounts twice in development; the action is a no-op the second time, but skip the round trip.
    if (started.current) return;
    started.current = true;
    run();
  }, []);

  if (error) {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-md border border-destructive px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-body-sm text-destructive">{error}</p>
        <Button variant="outline" size="sm" onClick={run} disabled={pending}>
          <RefreshCw aria-hidden className="size-4" />
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div role="status" className="flex items-center gap-3 rounded-md border px-4 py-3">
      <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />
      <div className="flex flex-col">
        <p className="text-body-sm font-medium">Reading your brokerages from SnapTrade</p>
        <p className="text-caption text-muted-foreground">This takes up to a minute the first time.</p>
      </div>
    </div>
  );
}
