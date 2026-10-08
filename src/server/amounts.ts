import "server-only";
import { cookies } from "next/headers";
import { AMOUNTS_COOKIE, AMOUNTS_HIDDEN } from "@/lib/amounts";

/** Whether this visitor has hidden their amounts, for pages that format money as they render. */
export async function amountsHidden(): Promise<boolean> {
  return (await cookies()).get(AMOUNTS_COOKIE)?.value === AMOUNTS_HIDDEN;
}
