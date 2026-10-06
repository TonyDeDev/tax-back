"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteCorporateAction, saveCorporateAction } from "@/app/(app)/hub/securities/[id]/actions";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput } from "./fields";

interface CorporateActionFormProps {
  securityId: string;
  symbol: string;
  currency: string;
  others: { id: string; symbol: string }[];
}

/** Records a spinoff or merger of this security. SnapTrade does not report them in a form TaxBack can use. */
export function CorporateActionForm({ securityId, symbol, currency, others }: CorporateActionFormProps) {
  const [pending, startTransition] = useTransition();
  const [kind, setKind] = useState<"spinoff" | "merger">("spinoff");
  const [targetSecurityId, setTarget] = useState(others[0]?.id ?? "");
  const [effectiveDate, setDate] = useState("");
  const [ratio, setRatio] = useState("");
  const [oldFmv, setOldFmv] = useState("");
  const [newFmv, setNewFmv] = useState("");
  const [cashPerShare, setCash] = useState("");
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const other = others.find((o) => o.id === targetSecurityId)?.symbol ?? "the other security";

  if (others.length === 0) {
    return (
      <p className="text-body-sm text-muted-foreground">
        The other security has to appear in your accounts first. Refresh once your broker shows it, then record the action here.
      </p>
    );
  }

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setMessage(null);
      const result = await saveCorporateAction({ securityId, kind, targetSecurityId, effectiveDate, ratio, oldFmv, newFmv, cashPerShare });
      setMessage(result.ok ? { error: false, text: "Saved. The tax results were recomputed." } : { error: true, text: result.message });
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="What happened">
          <SelectInput value={kind} onChange={(e) => setKind(e.target.value as "spinoff" | "merger")}>
            <option value="spinoff">{symbol} spun off shares</option>
            <option value="merger">{symbol} merged into another</option>
          </SelectInput>
        </Field>
        <Field label={kind === "spinoff" ? "Spun-off security" : "New security"}>
          <SelectInput value={targetSecurityId} onChange={(e) => setTarget(e.target.value)}>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.symbol}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Effective date">
          <TextInput type="date" value={effectiveDate} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label={`${other} per ${symbol}`} hint="Shares received for each one held">
          <TextInput inputMode="decimal" value={ratio} onChange={(e) => setRatio(e.target.value)} required />
        </Field>
        {kind === "spinoff" ? (
          <Field label={`${symbol} value per share (${currency})`} hint="Just after the spinoff">
            <TextInput inputMode="decimal" value={oldFmv} onChange={(e) => setOldFmv(e.target.value)} required />
          </Field>
        ) : (
          <Field label={`Cash per ${symbol} (${currency})`} hint="Leave empty for an all-share deal">
            <TextInput inputMode="decimal" value={cashPerShare} onChange={(e) => setCash(e.target.value)} />
          </Field>
        )}
        <Field label={`${other} value per share (${currency})`} hint={kind === "spinoff" ? "Splits the ACB by value" : "Needed when cash is paid"}>
          <TextInput inputMode="decimal" value={newFmv} onChange={(e) => setNewFmv(e.target.value)} required={kind === "spinoff"} />
        </Field>
      </div>
      <div>
        <Button type="submit" size="sm" variant="outline" disabled={pending}>
          {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Record {kind}
        </Button>
      </div>
      {message &&
        (message.error ? <FormError message={message.text} /> : <p className="text-caption text-muted-foreground">{message.text}</p>)}
    </form>
  );
}

export function DeleteCorporateActionButton({ securityId, id, label }: { securityId: string; id: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${label}`}
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await deleteCorporateAction(securityId, id);
            if (!result.ok) setError(result.message);
          })
        }
      >
        {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Trash2 aria-hidden className="size-4" />}
      </Button>
      <FormError message={error} />
    </span>
  );
}
