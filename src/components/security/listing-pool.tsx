"use client";

import { Loader2, Unlink } from "lucide-react";
import { useState, useTransition } from "react";
import { linkListing, setDividendClass, unlinkListing } from "@/app/(app)/hub/securities/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ListingView } from "@/server/queries/security";
import type { DividendClass } from "@/tax-engine/types";
import { Field, FormError, SelectInput } from "./fields";

const DIVIDEND_LABELS: Record<DividendClass, string> = {
  eligible: "Eligible (Canadian company)",
  non_eligible: "Non-eligible (Canadian company)",
  foreign: "Foreign income",
};

const REASON_LABELS: Record<ListingView["reason"], string> = {
  canonical: "ACB pooled here",
  figi: "Same shares (FIGI)",
  linked: "Linked by you",
};

interface ListingPoolProps {
  poolId: string;
  symbol: string;
  listings: ListingView[];
  others: { id: string; symbol: string }[];
  dividendOverride: DividendClass | null;
  automaticDividendClass: DividendClass;
  readOnly: boolean;
}

type Result = { ok: true } | { ok: false; message: string };

/**
 * Which listings are the same shares (one ACB pool, one superficial loss check), and what class their
 * dividends get. RY on the TSX and RY on the NYSE are joined automatically when SnapTrade gives both
 * the same share-class FIGI; otherwise the user links them here.
 */
export function ListingPool({ poolId, symbol, listings, others, dividendOverride, automaticDividendClass, readOnly }: ListingPoolProps) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState("");
  const [dividend, setDividend] = useState<string>(dividendOverride ?? "automatic");

  const run = (action: () => Promise<Result>) =>
    startTransition(async () => {
      setError(null);
      const result = await action();
      if (!result.ok) setError(result.message);
    });

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-border rounded-md border">
        {listings.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="flex flex-wrap items-center gap-2 text-body-sm">
              <span className="font-medium">{l.symbol}</span>
              <span className="text-muted-foreground">
                {l.exchange ?? "Unknown exchange"} · {l.currency}
              </span>
              <Badge variant="outline">{REASON_LABELS[l.reason]}</Badge>
            </span>
            {!readOnly && l.id !== poolId && (
              <Button
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => run(() => unlinkListing(poolId, l.id, "separate"))}
                title="Keep this listing's ACB separate"
              >
                <Unlink aria-hidden className="size-4" />
                Unlink
              </Button>
            )}
          </li>
        ))}
      </ul>

      {!readOnly && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
          {others.length > 0 && (
            <div className="flex items-end gap-2">
              <Field label={`Same shares as ${symbol}`} hint="For an interlisted stock SnapTrade did not match">
                <SelectInput value={linkTarget} onChange={(e) => setLinkTarget(e.target.value)}>
                  <option value="" disabled>
                    Choose a security
                  </option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.symbol}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <Button variant="outline" size="sm" className="mb-[1.375rem] h-9" disabled={pending || !linkTarget} onClick={() => run(() => linkListing(poolId, linkTarget))}>
                Link
              </Button>
            </div>
          )}
          <Field label="Dividends are" hint={`Automatic: ${DIVIDEND_LABELS[automaticDividendClass].toLowerCase()}, from the listings above`}>
            <SelectInput
              value={dividend}
              disabled={pending}
              onChange={(e) => {
                setDividend(e.target.value);
                run(() => setDividendClass(poolId, e.target.value));
              }}
            >
              <option value="automatic">Automatic</option>
              {(Object.keys(DIVIDEND_LABELS) as DividendClass[]).map((c) => (
                <option key={c} value={c}>
                  {DIVIDEND_LABELS[c]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
      )}
      {pending && (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <Loader2 aria-hidden className="size-4 animate-spin" /> Recomputing...
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
