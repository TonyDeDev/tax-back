const ISO = /^\d{4}-\d{2}-\d{2}$/;

function parseUtc(iso: string): Date {
  return new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))));
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isIsoDate(value: string): boolean {
  return ISO.test(value) && parseUtc(value).toISOString().slice(0, 10) === value;
}

export function addDays(iso: string, days: number): string {
  const date = parseUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4));
}
