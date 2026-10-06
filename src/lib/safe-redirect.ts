const FALLBACK = "/hub";
const PROBE_ORIGIN = "http://taxback.local";

/**
 * Returns `value` only if it is a path on this site, else `/hub`. Guards every `?next=` redirect:
 * `//evil.com` and `/\evil.com` are protocol-relative to browsers, so a leading slash is not enough.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return FALLBACK;
  // Browsers treat backslashes as slashes and strip tabs and newlines, which can turn a path into a new origin.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return FALLBACK;
  const url = new URL(value, PROBE_ORIGIN);
  return url.origin === PROBE_ORIGIN ? `${url.pathname}${url.search}${url.hash}` : FALLBACK;
}
