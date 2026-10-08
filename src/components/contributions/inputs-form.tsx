"use client";

import { useState, useTransition } from "react";
import { saveContributionInputs } from "@/app/(app)/contributions/actions";
import { Field, FormError, TextInput } from "@/components/security/fields";
import type { ContributionInputsView } from "@/server/queries/contributions";
import { SaveButton } from "./save-button";

export interface InputField {
  name: keyof ContributionInputsView;
  label: string;
  hint?: string;
  placeholder?: string;
}

interface ContributionInputsFormProps {
  plan: "tfsa" | "rrsp" | "fhsa";
  year: number;
  initial: ContributionInputsView;
  fields: InputField[];
  /** Fields shown behind a disclosure: estimate inputs most people never need. */
  moreFields?: InputField[];
  moreLabel?: string;
  readOnly: boolean;
}

/** The CRA figures for one plan and year. Blank fields fall back to TaxBack's estimate. */
export function ContributionInputsForm({ plan, year, initial, fields, moreFields = [], moreLabel, readOnly }: ContributionInputsFormProps) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const field = (f: InputField) => (
    <Field key={f.name} label={f.label} hint={f.hint}>
      <TextInput
        name={f.name}
        inputMode="decimal"
        autoComplete="off"
        placeholder={f.placeholder ?? "Not entered"}
        value={values[f.name]}
        disabled={readOnly || pending}
        onChange={(event) => {
          setValues({ ...values, [f.name]: event.target.value });
          setSaved(false);
        }}
      />
    </Field>
  );

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          setSaved(false);
          const result = await saveContributionInputs({ plan, year, ...values });
          if (result.ok) setSaved(true);
          else setError(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">{fields.map(field)}</div>
      {moreFields.length > 0 && (
        <details className="group flex flex-col gap-3">
          <summary className="cursor-pointer text-body-sm text-muted-foreground hover:text-foreground">{moreLabel}</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">{moreFields.map(field)}</div>
        </details>
      )}
      <SaveButton pending={pending} saved={saved} disabled={readOnly} />
      <FormError message={error} />
    </form>
  );
}
