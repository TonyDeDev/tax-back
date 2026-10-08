import "server-only";
import { decryptOAuthToken } from "better-auth/oauth2";
import { and, eq } from "drizzle-orm";
import type { Auth } from "@/server/auth/config";
import { SNAPTRADE_PROVIDER_ID } from "@/server/auth/snaptrade-provider";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";

/** RFC 7009 token revocation, from SnapTrade's OpenID discovery document. */
export const SNAPTRADE_REVOKE_URL = "https://api.snaptrade.com/oauth/revoke_token/";
const REVOKE_TIMEOUT_MS = 15_000;

/** SnapTrade could not confirm the grant was revoked, so nothing was deleted. */
export class RevokeFailedError extends Error {
  constructor(options?: ErrorOptions) {
    super("SnapTrade could not be reached to revoke TaxBack's access, so nothing was deleted. Try again in a minute.", options);
    this.name = "RevokeFailedError";
  }
}

interface RevokeCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * Revokes one token at SnapTrade. Revoking the refresh token ends the whole grant (RFC 7009 §2.1).
 * SnapTrade answers 200 for a token that is already invalid, so anything else is a real failure.
 */
export async function revokeSnapTradeToken(
  token: string,
  hint: "refresh_token" | "access_token",
  credentials: RevokeCredentials,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(SNAPTRADE_REVOKE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${encodeURIComponent(credentials.clientId)}:${encodeURIComponent(credentials.clientSecret)}`).toString("base64")}`,
      },
      body: new URLSearchParams({ token, token_type_hint: hint }),
      signal: AbortSignal.timeout(REVOKE_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new RevokeFailedError({ cause: error });
  }
  if (!res.ok) throw new RevokeFailedError({ cause: new Error(`SnapTrade revoke returned ${res.status}`) });
}

/**
 * "Delete my data": revoke TaxBack's SnapTrade grant first, so no token outlives the data, then delete the
 * user. Every table hangs off `users` with `ON DELETE CASCADE` (covered in schema.test.ts), so one delete
 * removes sessions, grants, connections, accounts, transactions, inputs, and every derived result.
 * Shared rows (securities, Bank of Canada rates) belong to no one and stay.
 */
export async function deleteUserData(
  db: AnyDb,
  auth: Auth,
  userId: string,
  credentials: RevokeCredentials | null,
  fetchImpl: typeof fetch = fetch,
  /** Runs after revocation and before the delete: the action signs out here, while the session still exists. */
  beforeDelete: () => Promise<void> = async () => {},
): Promise<void> {
  const grants = await db
    .select({ accessToken: s.accounts.accessToken, refreshToken: s.accounts.refreshToken })
    .from(s.accounts)
    .where(and(eq(s.accounts.userId, userId), eq(s.accounts.providerId, SNAPTRADE_PROVIDER_ID)));

  if (grants.length > 0) {
    // A grant without app credentials cannot be revoked; refuse rather than orphan it at SnapTrade.
    if (!credentials) throw new RevokeFailedError();
    // `$context` is the same AuthContext Better Auth passes its own helpers; the plugin generics only
    // make the inferred type wider than the helper's parameter.
    const ctx = (await auth.$context) as unknown as Parameters<typeof decryptOAuthToken>[1];
    for (const grant of grants) {
      const refresh = grant.refreshToken ? await decryptOAuthToken(grant.refreshToken, ctx) : null;
      const access = grant.accessToken ? await decryptOAuthToken(grant.accessToken, ctx) : null;
      if (refresh) await revokeSnapTradeToken(refresh, "refresh_token", credentials, fetchImpl);
      else if (access) await revokeSnapTradeToken(access, "access_token", credentials, fetchImpl);
    }
  }

  await beforeDelete();
  await db.delete(s.users).where(eq(s.users.id, userId));
}
