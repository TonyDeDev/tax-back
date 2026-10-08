/*
 * Where the "hide amounts" preference lives. A cookie rather than `localStorage`, so the server knows
 * it too: several pages format money while rendering, including into `aria-label` text, and a value
 * only the browser knew would leave those unmasked for a screen reader.
 */

export const AMOUNTS_COOKIE = "taxback.amounts";
/** The one value that means hidden; anything else, including absent, shows the amounts. */
export const AMOUNTS_HIDDEN = "hidden";
export const AMOUNTS_SHOWN = "shown";
