"use client";

import { Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { setMarginalRate } from "@/app/(app)/settings/actions";
import { Field, FormError, TextInput } from "@/components/security/fields";
import { Button } from "@/components/ui/button";

interface MarginalRateFormProps {
  /** The saved rate as a percent ("43.41"), or "" when none is set. */
  initialPercent: string;
  readOnly: boolean;
}

export function MarginalRateForm({ initialPercent, readOnly }: MarginalRateFormProps) {
  const [value, setValue] = useState(initialPercent);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          setSaved(false);
          const result = await setMarginalRate(value);
          if (result.ok) setSaved(true);
          else setError(result.message);
        });
      }}
    >
      <div className="flex items-end gap-2">
        <div className="w-40">
          <Field label="Marginal rate (%)">
            <TextInput
              name="marginalRate"
              inputMode="decimal"
              placeholder="43.41"
              autoComplete="off"
              value={value}
              disabled={readOnly || pending}
              onChange={(event) => {
                setValue(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
        </div>
        <Button type="submit" variant="outline" disabled={readOnly || pending} aria-busy={pending} className="h-9">
          {pending && <Loader2 aria-hidden className="size-4 animate-spin" />}
          Save
        </Button>
        {saved && (
          <span role="status" className="flex h-9 items-center gap-1 text-caption text-muted-foreground">
            <Check aria-hidden className="size-4 text-positive" />
            Saved
          </span>
        )}
      </div>
      <FormError message={error} />
    </form>
  );
}
