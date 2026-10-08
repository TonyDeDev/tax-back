"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { deleteMyData } from "@/app/(app)/settings/actions";
import { Button } from "@/components/ui/button";
import { DELETE_CONFIRMATION } from "@/lib/delete-data";

/**
 * Two steps, no browser dialog: the button opens an inline confirmation where the user types DELETE.
 * The action revokes SnapTrade access, signs out, deletes everything, and lands on the home page.
 */
export function DeleteData({ disabledReason }: { disabledReason?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();
  const ready = typed.trim() === DELETE_CONFIRMATION;

  if (disabledReason) {
    return (
      <div className="flex flex-col gap-2">
        <Button variant="destructive" size="sm" disabled className="self-start">
          Delete my data
        </Button>
        <p className="text-caption text-muted-foreground">{disabledReason}</p>
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button variant="destructive" size="sm" className="self-start" onClick={() => setConfirming(true)}>
        <Trash2 aria-hidden className="size-4" />
        Delete my data
      </Button>
    );
  }

  return (
    <form
      className="flex animate-pop-in flex-col gap-3 rounded-md border border-destructive p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        setError(null);
        startTransition(async () => {
          const result = await deleteMyData(typed);
          // Success redirects away, so only a failure comes back here.
          if (!result.ok) setError(result.message);
        });
      }}
    >
      <p className="text-body-sm">
        This revokes TaxBack&apos;s access to SnapTrade, then permanently deletes your accounts, transactions, inputs, and
        tax results. It cannot be undone. Your brokerages and your SnapTrade account are not affected.
      </p>
      <label htmlFor={inputId} className="text-caption text-muted-foreground">
        Type {DELETE_CONFIRMATION} to confirm
      </label>
      <input
        id={inputId}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        spellCheck={false}
        disabled={pending}
        className="h-10 w-full max-w-60 rounded-md border bg-background px-3 font-mono text-body-sm transition-motion focus-visible:border-destructive"
      />
      {error && (
        <p role="alert" className="text-caption text-negative">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="destructive" size="sm" disabled={!ready || pending} aria-busy={pending}>
          {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Delete everything
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => {
            setConfirming(false);
            setTyped("");
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
