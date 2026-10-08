"use client";

import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Submit button with a spinner while saving and a "Saved" note after. */
export function SaveButton({ pending, saved, disabled, label = "Save" }: { pending: boolean; saved: boolean; disabled: boolean; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" variant="outline" disabled={disabled || pending} aria-busy={pending} className="h-9">
        {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
        {label}
      </Button>
      {saved && (
        <span role="status" className="flex h-9 items-center gap-1 text-caption text-muted-foreground">
          <Check aria-hidden className="size-4 text-positive" />
          Saved
        </span>
      )}
    </div>
  );
}
