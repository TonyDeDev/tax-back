import { D, type Dec } from "./decimal";
import type { AccountType, DividendClass, EntryKind, FxLookup, LedgerEntry } from "./types";

let counter = 0;

interface EntryInit {
  id?: string;
  kind: EntryKind;
  date: string;
  settle?: string;
  qty?: number | string;
  price?: number | string;
  fees?: number | string;
  amount?: number | string;
  account?: string;
  type?: AccountType;
  security?: string;
  currency?: string;
  ratio?: number | string;
  cls?: DividendClass;
  withholding?: number | string;
}

export function entry(init: EntryInit): LedgerEntry {
  counter += 1;
  const security = init.security ?? "XYZ";
  return {
    id: init.id ?? `e${counter}`,
    accountId: init.account ?? "acct-a",
    accountType: init.type ?? "non_registered",
    securityId: security,
    symbol: security,
    currency: init.currency ?? "CAD",
    kind: init.kind,
    tradeDate: init.date,
    settlementDate: init.settle ?? init.date,
    quantity: new D(init.qty ?? 0),
    price: new D(init.price ?? 0),
    fees: new D(init.fees ?? 0),
    amount: new D(init.amount ?? 0),
    splitRatio: init.ratio === undefined ? undefined : new D(init.ratio),
    dividendClass: init.cls,
    withholdingTax: init.withholding === undefined ? undefined : new D(init.withholding),
  };
}

/** FX stub: CAD is 1, every other currency uses the supplied constant (default 1.25). */
export function flatFx(usdCad: number | string = "1.25"): FxLookup {
  return (currency) => (currency === "CAD" ? new D(1) : new D(usdCad));
}

export function d(value: number | string): Dec {
  return new D(value);
}
