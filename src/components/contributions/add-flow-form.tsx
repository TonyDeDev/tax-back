"use client";

import { useState, useTransition } from "react";
import { addManualContribution } from "@/app/(app)/contributions/actions";
import { Field, FormError, SelectInput, TextInput } from "@/components/security/fields";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import type { Plan } from "@/tax-engine/contributions/types";
import { SaveButton } from "./save-button";

const PLANS: Plan[] = ["tfsa", "rrsp", "fhsa", "resp", "rrif", "lira", "us_retirement"];
const KINDS = [
  ["contribution", "Contribution"],
  ["withdrawal", "Withdrawal"],
  ["rrsp_to_fhsa", "Transfer from RRSP"],
] as const;

const EMPTY = { plan: "rrsp", kind: "contribution", date: "", amount: "", description: "" };

/**
 * A contribution TaxBack cannot see: a group RRSP through work, a spousal RRSP, or an account at an
 * institution that is not connected. Amounts are in CAD, as on the receipt.
 */
export function AddFlowForm({ today, readOnly }: { today: string; readOnly: boolean }) {
  const [values, setValues] = useState(EMPTY);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (name: keyof typeof EMPTY, value: string) => {
    // A transfer from an RRSP only lands in an FHSA.
    setValues((v) => ({ ...v, [name]: value, ...(name === "plan" && value !== "fhsa" && v.kind === "rrsp_to_fhsa" ? { kind: "contribution" } : {}) }));
    setSaved(false);
  };
  const disabled = readOnly || pending;

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          setError(null);
          setSaved(false);
          const result = await addManualContribution(values);
          if (result.ok) {
            setSaved(true);
            setValues(EMPTY);
          } else setError(result.message);
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Plan">
          <SelectInput name="plan" value={values.plan} disabled={disabled} onChange={(e) => set("plan", e.target.value)}>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {ACCOUNT_TYPE_LABELS[p]}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Type">
          <SelectInput name="kind" value={values.kind} disabled={disabled} onChange={(e) => set("kind", e.target.value)}>
            {KINDS.filter(([k]) => k !== "rrsp_to_fhsa" || values.plan === "fhsa").map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Date">
          <TextInput name="date" type="date" max={today} min="2009-01-01" value={values.date} disabled={disabled} onChange={(e) => set("date", e.target.value)} />
        </Field>
        <Field label="Amount (CAD)">
          <TextInput
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="5000"
            value={values.amount}
            disabled={disabled}
            onChange={(e) => set("amount", e.target.value)}
          />
        </Field>
      </div>
      <Field label="Note" hint="Optional, such as the institution or a group plan.">
        <TextInput
          name="description"
          autoComplete="off"
          maxLength={200}
          placeholder="Group RRSP at work"
          value={values.description}
          disabled={disabled}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <SaveButton pending={pending} saved={saved} disabled={readOnly} label="Add" />
      <FormError message={error} />
    </form>
  );
}
