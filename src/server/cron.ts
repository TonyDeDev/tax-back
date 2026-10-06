import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Auth } from "@/server/auth/config";
import { SNAPTRADE_PROVIDER_ID } from "@/server/auth/snaptrade-provider";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
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
}

/** The daily job: drop expired sessions, then sync every user with a SnapTrade grant, one at a time. */
export async function runDailyCron(db: AnyDb, auth: Auth, now: Date = new Date()): Promise<CronResult> {
  const expired = await db.delete(s.sessions).where(lt(s.sessions.expiresAt, now)).returning({ id: s.sessions.id });

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
  return { users: users.length, outcomes, expiredSessionsDeleted: expired.length };
}
