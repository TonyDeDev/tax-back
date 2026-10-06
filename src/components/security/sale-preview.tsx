"use client";

import { Calculator, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { type SalePreviewView, previewSaleAction } from "@/app/(app)/hub/securities/[id]/actions";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { ACCOUNT_TYPE_LABELS } from "@/lib/account-types";
import { formatDate, formatMoney, formatPercent, formatQuantity } from "@/lib/format";
import type { AccountType } from "@/tax-engine/types";
import { Field, FormError, SelectInput, TextInput } from "./fields";

interface SalePreviewProps {
  securityId: string;
  symbol: string;
  /** Pooled non-registered units: the most a taxable sale can be. */
  maxQuantity: string;
  /** Latest price and its currency, to prefill the form. */
  price: { price: string; currency: string } | null;
  /** Currencies the pooled listings trade in (RY in CAD on the TSX and USD on the NYSE). */
  currencies: string[];
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-body-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-body-sm tabular-nums">{children}</dd>
    </div>
  );
}

function Result({ p }: { p: SalePreviewView }) {
  const loss = Number(p.gainCad) < 0;
  const superficial = p.superficialStatus !== null;
  return (
    <div className="flex flex-col gap-4">
      <dl className="flex flex-col divide-y divide-border rounded-md border px-4">
        <Row label={`Proceeds (${formatQuantity(p.quantity)} units${p.currency !== "CAD" ? `, 1 ${p.currency} = ${p.fxRate} CAD` : ""})`}>
          <Money value={p.proceedsCad} />
        </Row>
        <Row label="ACB of the units sold">
          <Money value={p.acbCad} />
        </Row>
        <Row label="Commission">
          <Money value={p.feesCad} />
        </Row>
        <Row label="Capital gain or loss">
          <Money value={p.gainCad} signed />
        </Row>
        {superficial && (
          <Row label="Denied as superficial">
            <Money value={p.deniedLossCad} />
          </Row>
        )}
        <Row label={`Taxable at ${formatPercent(p.inclusionRate, 0)} inclusion`}>
          <Money value={p.taxableCad} signed />
        </Row>
        <Row label="Estimated tax on this sale">
          {p.estimatedTaxCad === null ? <span className="text-muted-foreground">Set a marginal rate</span> : <Money value={p.estimatedTaxCad} signed />}
        </Row>
      </dl>

      {superficial ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-negative/40 bg-negative/10 px-4 py-3">
          <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-negative" />
          <div className="flex flex-col gap-1 text-body-sm">
            <p>
              <strong>Superficial loss window is open.</strong> {formatMoney(p.deniedLossCad)} of this loss would be denied because of
              purchases between {formatDate(p.windowStart)} and today:
            </p>
            <ul className="list-disc pl-5">
              {p.recentPurchases.map((r, i) => (
                <li key={i}>
                  {formatQuantity(r.quantity)} units on {formatDate(r.date)} in a {ACCOUNT_TYPE_LABELS[r.accountType as AccountType] ?? r.accountType}{" "}
                  account
                </li>
              ))}
            </ul>
            {Number(p.lostForeverCad) > 0 && (
              <p>
                {formatMoney(p.lostForeverCad)} of it is lost for good, because the replacement units are in a registered account.
              </p>
            )}
            <p className="text-muted-foreground">Selling the replacement units before {formatDate(p.windowEnd)} could change this.</p>
          </div>
        </div>
      ) : loss ? (
        <div className="flex items-start gap-2 rounded-md border px-4 py-3">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-positive" />
          <p className="text-body-sm">
            No purchase in the last 30 days, so the loss would be allowed. To keep it, do not buy {p.symbol} in <strong>any</strong> account,
            TFSA and RRSP included, before {formatDate(p.noRebuyBefore ?? p.windowEnd)}.
          </p>
        </div>
      ) : null}
      <p className="text-caption text-muted-foreground">
        Trade {formatDate(p.tradeDate)}, settles {formatDate(p.settlementDate)}. Same engine and rules as your recorded history; nothing is
        saved.
      </p>
    </div>
  );
}

/** "What if I sell?": the ledger run one step forward on the server. */
export function SalePreview({ securityId, symbol, maxQuantity, price, currencies }: SalePreviewProps) {
  const [pending, startTransition] = useTransition();
  const [quantity, setQuantity] = useState(maxQuantity);
  const [unitPrice, setUnitPrice] = useState(price?.price ? String(Number(price.price)) : "");
  const [fees, setFees] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SalePreviewView | null>(null);
  const [priceCurrency, setCurrency] = useState(price?.currency ?? currencies[0] ?? "CAD");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      setError(null);
      const response = await previewSaleAction({ securityId, quantity, price: unitPrice, fees, currency: priceCurrency });
      if (response.ok) setResult(response.preview);
      else {
        setResult(null);
        setError(response.message);
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        onSubmit={submit}
        className={
          currencies.length > 1
            ? "grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_6rem_1fr_auto] sm:items-end"
            : "grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
        }
      >
        <Field label="Units to sell" hint={`${formatQuantity(maxQuantity)} held in non-registered accounts`}>
          <TextInput inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </Field>
        <Field label={`Price per unit (${priceCurrency})`} hint={price ? "Latest price from your broker" : undefined}>
          <TextInput inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} required />
        </Field>
        {currencies.length > 1 && (
          <Field label="Currency" hint="Listing sold on">
            <SelectInput value={priceCurrency} onChange={(e) => setCurrency(e.target.value)}>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label={`Commission (${priceCurrency})`}>
          <TextInput inputMode="decimal" value={fees} onChange={(e) => setFees(e.target.value)} />
        </Field>
        <Button type="submit" disabled={pending} className="sm:mb-[1.375rem]">
          {pending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Calculator aria-hidden className="size-4" />}
          Preview sale of {symbol}
        </Button>
      </form>
      <FormError message={error} />
      {result && <Result p={result} />}
    </div>
  );
}
