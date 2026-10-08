"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { deleteManualContribution, reclassifyFlow } from "@/app/(app)/contributions/actions";
import { useAmountsHidden } from "@/components/amounts";
import { Money } from "@/components/money";
import { FormError, SelectInput } from "@/components/security/fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { BROKER_TYPE_LABELS, CLASSIFICATION_OPTIONS, FLOW_KIND_LABELS } from "@/lib/contribution-labels";
import { formatDate } from "@/lib/format";
import type { FlowView } from "@/server/queries/contributions";

/** The classifications that make sense for a flow: an RRSP-to-FHSA transfer only leaves an RRSP or enters an FHSA. */
function optionsFor(flow: FlowView) {
  const rrspToFhsa = (flow.plan === "fhsa" && flow.direction === "in") || (flow.plan === "rrsp" && flow.direction === "out");
  return CLASSIFICATION_OPTIONS.filter(([value]) => value !== "rrsp_to_fhsa" || rrspToFhsa);
}

function What({ flow }: { flow: FlowView }) {
  const source = flow.source === "manual" ? "Entered by you" : (BROKER_TYPE_LABELS[flow.brokerType ?? ""] ?? flow.brokerType);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-body-sm">
        {flow.accountName ?? ACCOUNT_TYPE_LABELS[flow.plan]}
        <span className="text-muted-foreground"> · {source}</span>
      </span>
      {flow.description && <span className="truncate text-caption text-muted-foreground">{flow.description}</span>}
    </span>
  );
}

function Amount({ flow }: { flow: FlowView }) {
  // Hidden amounts hide the sign too, like every other masked figure.
  const sign = useAmountsHidden() ? "" : flow.direction === "out" ? "-" : "+";
  return (
    <span className="flex flex-col items-end">
      <span className="text-body-sm font-medium tabular-nums">
        {sign}
        <Money value={flow.amountCad} />
      </span>
      {flow.currency !== "CAD" && (
        <span className="text-caption text-muted-foreground">
          <Money value={flow.amount} currency={flow.currency} />
        </span>
      )}
    </span>
  );
}

function CountedAs({ flow, readOnly }: { flow: FlowView; readOnly: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (flow.source === "manual") {
    return (
      <div className="flex items-center justify-end gap-2">
        <span className="text-body-sm">{FLOW_KIND_LABELS[flow.kind]}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={`Delete the ${formatDate(flow.date)} entry`}
          disabled={readOnly || pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await deleteManualContribution({ flowId: flow.id });
              if (!result.ok) setError(result.message);
            })
          }
        >
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Trash2 aria-hidden className="size-4" />}
        </Button>
        <FormError message={error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1">
      <div className="flex items-center gap-2">
        {pending && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-muted-foreground" />}
        <SelectInput
          aria-label={`Count the ${formatDate(flow.date)} ${flow.direction === "in" ? "deposit" : "withdrawal"} as`}
          className="min-w-0"
          value={flow.classification ?? "auto"}
          disabled={readOnly || pending}
          onChange={(event) => {
            const classification = event.target.value;
            startTransition(async () => {
              setError(null);
              const result = await reclassifyFlow({ flowId: flow.id, classification });
              if (!result.ok) setError(result.message);
            });
          }}
        >
          {optionsFor(flow).map(([value, label]) => (
            <option key={value} value={value}>
              {value === "auto" && flow.classification === null ? `${FLOW_KIND_LABELS[flow.kind]} (automatic)` : label}
            </option>
          ))}
        </SelectInput>
      </div>
      <FormError message={error} />
    </div>
  );
}

/**
 * Cash in and out of registered accounts that counts for the year, with how each one is read. A transfer
 * TaxBack could not pair is flagged for review; changing a row recomputes room and the forms.
 */
export function FlowList({ flows, readOnly }: { flows: FlowView[]; readOnly: boolean }) {
  return (
    <ul className="flex flex-col divide-y divide-border rounded-md border">
      {flows.map((flow) => (
        // Narrow: date and amount on one line, then the account, then the choice. Wider: one row.
        <li
          key={flow.id}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 xl:grid-cols-[7rem_minmax(0,1fr)_8rem_18rem]"
        >
          <span className="flex flex-wrap items-center gap-2 xl:flex-col xl:items-start xl:gap-1">
            <span className="text-body-sm tabular-nums">{formatDate(flow.date)}</span>
            {flow.needsReview && <Badge variant="negative">Review</Badge>}
          </span>
          <span className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1">
            <What flow={flow} />
          </span>
          <span className="col-start-2 row-start-1 xl:col-start-3">
            <Amount flow={flow} />
          </span>
          <span className="col-span-2 xl:col-span-1">
            <CountedAs flow={flow} readOnly={readOnly} />
          </span>
        </li>
      ))}
    </ul>
  );
}
