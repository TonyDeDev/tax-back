import "server-only";
import type { GenericOAuthConfig } from "better-auth/plugins/generic-oauth";

/*
 * "Sign in with SnapTrade": SnapTrade is an OpenID Connect provider for SnapTrade Personal users.
 * One consent both signs the user in and grants read access to the brokerages they connected in
 * their SnapTrade account, so there is no separate connect step and no SnapTrade user to register.
 * See https://docs.snaptrade.com/docs/oauth-apps.
 */

export const SNAPTRADE_PROVIDER_ID = "snaptrade";
export const SNAPTRADE_ISSUER = "https://api.snaptrade.com";
export const SNAPTRADE_DISCOVERY_URL = `${SNAPTRADE_ISSUER}/.well-known/openid-configuration`;
/** Where users add, repair, or remove brokerage connections; TaxBack cannot do it for them. */
export const SNAPTRADE_DASHBOARD_URL = "https://dashboard.snaptrade.com";

/**
 * `read` is mandatory and is all TaxBack needs from the API. Never request `trade`: TaxBack only reads.
 * `email` and `profile` are optional for the user, so sign-in must work without them.
 */
export const SNAPTRADE_SCOPES = ["openid", "email", "profile", "read"];

/** Used when the user declines the `email` scope; `.invalid` can never receive mail or be verified. */
export const placeholderEmail = (sub: string) => `snaptrade-${sub.toLowerCase()}@users.taxback.invalid`;

/** The payload of a compact JWT, or null if it is not one. Decodes only; it does not verify. */
function jwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload: unknown = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return payload !== null && typeof payload === "object" ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Maps the id_token to a user. SnapTrade has no userinfo endpoint, so the id_token is the only source.
 * Better Auth has already verified it against the discovery JWKS, issuer, audience, and nonce before
 * calling this (`requireIdTokenVerification`), so decoding here is safe. A missing token fails closed.
 */
export function userFromIdToken(idToken: string | undefined) {
  if (!idToken) return null;
  const claims = jwtPayload(idToken);
  if (!claims || typeof claims.sub !== "string" || claims.sub === "") return null;

  const email = typeof claims.email === "string" && claims.email !== "" ? claims.email.toLowerCase() : null;
  return {
    // Better Auth keys OIDC accounts on `sub`; `id` is the generic OAuth field it would otherwise read.
    sub: claims.sub,
    id: claims.sub,
    email: email ?? placeholderEmail(claims.sub),
    emailVerified: email !== null && claims.email_verified === true,
    name: typeof claims.name === "string" && claims.name.trim() !== "" ? claims.name : "SnapTrade user",
    image: typeof claims.picture === "string" ? claims.picture : undefined,
  };
}

export function snaptradeProvider(clientId: string, clientSecret: string): GenericOAuthConfig {
  return {
    providerId: SNAPTRADE_PROVIDER_ID,
    discoveryUrl: SNAPTRADE_DISCOVERY_URL,
    clientId,
    clientSecret,
    scopes: SNAPTRADE_SCOPES,
    pkce: true,
    // The self-serve app is a confidential client that authenticates with HTTP Basic.
    authentication: "basic",
    // Skip the provider entirely rather than accept an unverified id_token if discovery fails.
    requireIdTokenVerification: true,
    getUserInfo: async (tokens) => userFromIdToken(tokens.idToken),
  };
}
