import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Auth } from "@/server/auth/config";
import { SNAPTRADE_PROVIDER_ID } from "@/server/auth/snaptrade-provider";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { seedDemo } from "@/server/demo/seed";
import { torontoToday } from "@/server/recompute";
import { syncUser } from "@/server/sync/sync";

const digest = (value: string) => createHash("sha256").update(value).digest();

/**
 * Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Compared in constant time over hashes, so
 * neither the content nor the length of the secret leaks through timing. No secret configured means no access.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}

export interface CronResult {
  users: number;
  outcomes: Record<string, number>;
  expiredSessionsDeleted: number;
  /** The demo portfolio was reset to its starting state, with dates moved up to today. */
  demoReset: boolean;
}

/**
 * The daily job: drop expired sessions, reset the demo portfolio, then sync every user with a SnapTrade
 * grant, one at a time.
 */
export async function runDailyCron(
  db: AnyDb,
  auth: Auth,
  now: Date = new Date(),
  resetDemo: (db: AnyDb, today: string) => Promise<void> = seedDemo,
): Promise<CronResult> {
  const expired = await db.delete(s.sessions).where(lt(s.sessions.expiresAt, now)).returning({ id: s.sessions.id });

  let demoReset = false;
  try {
    await resetDemo(db, torontoToday(now));
    demoReset = true;
  } catch (error) {
    // A failed reset leaves yesterday's demo in place; it must not stop real users' syncs.
    console.error("[cron] demo reset failed", error);
  }

  const users = await db
    .selectDistinct({ userId: s.accounts.userId })
    .from(s.accounts)
    .where(eq(s.accounts.providerId, SNAPTRADE_PROVIDER_ID));

  const outcomes: Record<string, number> = {};
  for (const { userId } of users) {
    let status: string;
    try {
      status = (await syncUser(db, auth, userId, "cron")).status;
    } catch (error) {
      // One user's failure must not stop the others.
      console.error(`[cron] sync for user ${userId} threw`, error);
      status = "error";
    }
    outcomes[status] = (outcomes[status] ?? 0) + 1;
  }
  return { users: users.length, outcomes, expiredSessionsDeleted: expired.length, demoReset };
}
