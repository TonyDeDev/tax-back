"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteOpeningBalance, saveOpeningBalance } from "@/app/(app)/hub/securities/[id]/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, TextInput } from "./fields";

interface OpeningBalanceFormProps {
  securityId: string;
  symbol: string;
  existing: { quantity: string; acbCad: string; asOfDate: string; note: string | null } | null;
  /** Prefills: the gap the reconciliation found and the start of the known history. */
  suggestedQuantity: string | null;
  suggestedDate: string | null;
}

/**
 * Fills a reconciliation gap: the units held and their total ACB in CAD at the start of a date,
 * usually from an old statement or the broker the shares were transferred from.
 */
export function OpeningBalanceForm({ securityId, symbol, existing, suggestedQuantity, suggestedDate }: OpeningBalanceFormProps) {
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(existing ? String(Number(existing.quantity)) : (suggestedQuantity ?? ""));
  const [acbCad, setAcbCad] = useState(existing ? String(Number(existing.acbCad)) : "");
  const [asOfDate, setAsOfDate] = useState(existing?.asOfDate ?? suggestedDate ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);

  const run = (action: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string) =>
    startTransition(async () => {
      setMessage(null);
      const result = await action();
      setMessage(result.ok ? { error: false, text: done } : { error: true, text: result.message });
    });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        run(() => saveOpeningBalance({ securityId, quantity, acbCad, asOfDate, note }), "Saved. The tax results were recomputed.");
      }}
      className="flex flex-col gap-3"
    >
      <p className="text-body-sm text-muted-foreground">
        Units of {symbol} held in non-registered accounts at the start of the date, and what they cost in total in CAD. This replaces any
        earlier non-registered history for {symbol}.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Units held">
          <TextInput inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </Field>
        <Field label="Total ACB (CAD)">
          <TextInput inputMode="decimal" value={acbCad} onChange={(e) => setAcbCad(e.target.value)} required />
        </Field>
        <Field label="As of">
          <TextInput type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} required />
        </Field>
      </div>
      <Field label="Note (optional)">
        <TextInput value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. transferred from my bank's brokerage" />
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
          {existing ? "Update opening balance" : "Save opening balance"}
        </Button>
        {existing && (
          <Button
            variant="destructive"
            size="sm"
            disabled={pending}
            onClick={() => run(() => deleteOpeningBalance(securityId), "Removed. The tax results were recomputed.")}
          >
            Remove
          </Button>
        )}
      </div>
      {message &&
        (message.error ? <FormError message={message.text} /> : <p className="text-caption text-muted-foreground">{message.text}</p>)}
    </form>
  );
}
