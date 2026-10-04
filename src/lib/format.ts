export type NumericInput = number | string;

function toNumber(value: NumericInput): number {
  return typeof value === "number" ? value : Number(value);
}

/** Display only. Tax math is never done in the browser, so converting a saved decimal string to a number here is safe. */
export function formatMoney(value: NumericInput, currency = "CAD", opts: { signed?: boolean } = {}): string {
  const n = toNumber(value);
  const text = new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    signDisplay: opts.signed ? "exceptZero" : "auto",
  }).format(n);
  return text;
}

export function formatQuantity(value: NumericInput, maxFractionDigits = 4): string {
  return new Intl.NumberFormat("en-CA", { maximumFractionDigits: maxFractionDigits }).format(toNumber(value));
}

/** `value` is a fraction: 0.5 becomes "50%". */
export function formatPercent(value: NumericInput, fractionDigits = 1): string {
  return new Intl.NumberFormat("en-CA", {
    style: "percent",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(toNumber(value));
}

/** Format a YYYY-MM-DD string without time zone drift. */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)),
  );
}

export type Direction = "gain" | "loss" | "flat";

export function directionOf(value: NumericInput): Direction {
  const n = toNumber(value);
  return n > 0 ? "gain" : n < 0 ? "loss" : "flat";
}
