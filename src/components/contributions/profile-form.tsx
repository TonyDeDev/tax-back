"use client";

import { useState, useTransition } from "react";
import { saveContributionProfile } from "@/app/(app)/contributions/actions";
import { Field, FormError, TextInput } from "@/components/security/fields";
import type { ContributionProfileView } from "@/server/queries/contributions";
import { SaveButton } from "./save-button";

/** Birth year, residency, and the first FHSA: what TaxBack needs to estimate room without CRA's figures. */
export function ContributionProfileForm({ initial, readOnly }: { initial: ContributionProfileView; readOnly: boolean }) {
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const field = (name: keyof ContributionProfileView, label: string, hint: string, placeholder: string) => (
    <Field label={label} hint={hint}>
      <TextInput
        name={name}
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        placeholder={placeholder}
        value={values[name]}
        disabled={readOnly || pending}
        onChange={(event) => {
          setValues({ ...values, [name]: event.target.value });
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
          const result = await saveContributionProfile(values);
          if (result.ok) setSaved(true);
          else setError(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {field("birthYear", "Birth year", "TFSA room starts the year you turn 18.", "1990")}
        {field("residentSinceYear", "Resident of Canada since", "Blank if you always were.", "Always")}
        {field("fhsaOpenedYear", "First FHSA opened in", "Blank to use your first FHSA activity.", "Automatic")}
      </div>
      <SaveButton pending={pending} saved={saved} disabled={readOnly} />
      <FormError message={error} />
    </form>
  );
}
