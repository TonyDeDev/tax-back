import "server-only";
import { and, eq } from "drizzle-orm";
import type { Auth } from "@/server/auth/config";
import { SNAPTRADE_PROVIDER_ID } from "@/server/auth/snaptrade-provider";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { type SnapTradeClient, SnapTradeUnauthorizedError, snaptradeClient } from "./client";

/** The grant is gone, revoked, or its refresh token no longer works: the user must connect SnapTrade again. */
export class SnapTradeReauthRequiredError extends Error {
  constructor(message = "SnapTrade access has expired. Connect with SnapTrade again.") {
    super(message);
    this.name = "SnapTradeReauthRequiredError";
  }
}

/**
 * Runs `fn` with a client holding a valid access token. Better Auth refreshes an expired token and
 * stores the rotated refresh token; a `401` anyway (revoked early, clock skew) forces one refresh and
 * one retry. `fn` may run twice, so it must only read from SnapTrade, never write to the database.
 *
 * SnapTrade refresh tokens rotate on use, so two refreshes racing for one user would leave one of them
 * holding a dead token. Only call this while holding the user's `sync_runs` lock.
 */
export async function withSnapTrade<T>(
  db: AnyDb,
  auth: Auth,
  userId: string,
  fn: (client: SnapTradeClient) => Promise<T>,
): Promise<T> {
  const [grant] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.userId, userId), eq(s.accounts.providerId, SNAPTRADE_PROVIDER_ID)))
    .limit(1);
  if (!grant) throw new SnapTradeReauthRequiredError("SnapTrade is not connected.");

  // No request headers: the server acts for `userId` directly, never for whoever is signed in.
  const body = { accountId: grant.id, userId };
  let token: string;
  try {
    token = (await auth.api.getAccessToken({ body })).accessToken;
  } catch {
    throw new SnapTradeReauthRequiredError();
  }

  try {
    return await fn(snaptradeClient(token));
  } catch (error) {
    if (!(error instanceof SnapTradeUnauthorizedError)) throw error;
  }

  const refreshed = await auth.api.refreshToken({ body }).catch(() => null);
  if (!refreshed?.accessToken) throw new SnapTradeReauthRequiredError();
  token = refreshed.accessToken;
  try {
    return await fn(snaptradeClient(token));
  } catch (error) {
    if (error instanceof SnapTradeUnauthorizedError) throw new SnapTradeReauthRequiredError();
    throw error;
  }
}
