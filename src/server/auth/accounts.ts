import "server-only";
import { and, eq } from "drizzle-orm";
import type { AnyDb } from "@/server/db/types";
import * as s from "@/server/db/schema";
import { SNAPTRADE_PROVIDER_ID } from "./snaptrade-provider";

/**
 * Whether the user has granted TaxBack access to SnapTrade, either by signing in with it or by connecting
 * it later from Settings. Without the grant there is nothing to sync.
 */
export async function hasSnapTradeGrant(db: AnyDb, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.userId, userId), eq(s.accounts.providerId, SNAPTRADE_PROVIDER_ID)))
    .limit(1);
  return row !== undefined;
}
