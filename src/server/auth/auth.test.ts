import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as s from "@/server/db/schema";
import { type Auth, createAuth } from "./config";
import { DEMO_USER_ID, isDemoAllowedPath } from "./demo-plugin";
import { placeholderEmail, SNAPTRADE_DISCOVERY_URL, SNAPTRADE_ISSUER } from "./snaptrade-provider";

/*
 * Runs the production auth config against an in-process Postgres with the real migrations, and drives
 * it through `auth.handler` with plain Requests, so origin checks, hooks, and rate limits all apply.
 * SnapTrade's OIDC endpoints are stubbed with a locally generated signing key, so the full
 * "Sign in with SnapTrade" round trip runs, including id_token signature, audience, and nonce checks.
 */

const BASE = "http://localhost:3000";
const CLIENT_ID = "st-test-client";
const CLIENT_SECRET = "st-test-secret";
const GOOGLE_CLIENT_ID = "google-test-client";
const env = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: BASE,
  DEMO_USER_EMAIL: "demo@taxback.invalid",
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: "google-test-secret",
  SNAPTRADE_OAUTH_CLIENT_ID: CLIENT_ID,
  SNAPTRADE_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
};

// ===== Stub SnapTrade and Google OIDC providers =====

const signingKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const strangerKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KID = "test-key";
const TOKEN_URL = `${SNAPTRADE_ISSUER}/oauth/token/`;
const JWKS_URL = `${SNAPTRADE_ISSUER}/.well-known/jwks.json`;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const publicJwk = () => ({ ...signingKey.publicKey.export({ format: "jwk" }), kid: KID, alg: "RS256", use: "sig" });

function signJwt(claims: Record<string, unknown>, key: KeyObject = signingKey.privateKey) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${encode({ alg: "RS256", kid: KID, typ: "JWT" })}.${encode(claims)}`;
  return `${body}.${sign("sha256", Buffer.from(body), key).toString("base64url")}`;
}

/** What the next token exchange returns; each sign-in sets it from the nonce in its authorization URL. */
let nextIdToken: (nonce: string) => string;
const tokenRequests: { authorization: string | null; body: URLSearchParams }[] = [];

beforeAll(() => {
  const real = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url === SNAPTRADE_DISCOVERY_URL) {
      return Response.json({
        issuer: SNAPTRADE_ISSUER,
        authorization_endpoint: "https://dashboard.snaptrade.com/oauth/authorize",
        token_endpoint: TOKEN_URL,
        jwks_uri: JWKS_URL,
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (request.url === JWKS_URL || request.url === GOOGLE_CERTS_URL) return Response.json({ keys: [publicJwk()] });
    if (request.url === GOOGLE_TOKEN_URL) {
      const code = new URLSearchParams(await request.text()).get("code") ?? "";
      return Response.json({
        access_token: `google-access-${code}`,
        expires_in: 3600,
        token_type: "Bearer",
        scope: "openid email profile",
        id_token: nextIdToken(pendingNonce),
      });
    }
    if (request.url === TOKEN_URL) {
      const body = new URLSearchParams(await request.text());
      tokenRequests.push({ authorization: request.headers.get("authorization"), body });
      const code = body.get("code") ?? "";
      return Response.json({
        access_token: `st-access-${code}`,
        refresh_token: `st-refresh-${code}`,
        expires_in: 36000,
        token_type: "Bearer",
        scope: "openid email profile read",
        id_token: nextIdToken(pendingNonce),
      });
    }
    return real(input, init);
  });
});

let pendingNonce = "";

// ===== Test harness =====

let client: PGlite;
let db: PgliteDatabase<typeof s>;
let auth: Auth;
let ip = 0;

/** Each call gets its own client IP so the demo rate limit only trips in the test that wants it. */
function call(route: string, init: { method?: string; cookie?: string; body?: unknown; ip?: string } = {}) {
  const headers = new Headers({ origin: BASE, "x-forwarded-for": init.ip ?? `10.0.0.${++ip}` });
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${BASE}/api/auth${route}`, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
}

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!)
    .join("; ");

function sessionCookie(response: Response): string | undefined {
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.startsWith("better-auth.session_token=") && !/Max-Age=0/i.test(c));
  return cookie?.split(";")[0];
}

async function demoSignIn(ip?: string) {
  const response = await call("/demo/sign-in", { body: {}, ip });
  expect(response.status).toBe(200);
  return sessionCookie(response)!;
}

let code = 0;

interface Identity {
  sub: string;
  email?: string;
  emailVerified?: boolean;
  name?: string;
  /** Overrides for negative tests. */
  claims?: Record<string, unknown>;
  key?: KeyObject;
}

type Provider = "snaptrade" | "google";

const ISSUER: Record<Provider, string> = { snaptrade: SNAPTRADE_ISSUER, google: "https://accounts.google.com" };
const AUDIENCE: Record<Provider, string> = { snaptrade: CLIENT_ID, google: GOOGLE_CLIENT_ID };

/**
 * Starts a sign-in (or, with a session cookie and `link`, a "Connect with SnapTrade" link) and returns the
 * authorization URL plus every cookie the callback needs.
 */
async function startFlow(provider: Provider, opts: { session?: string; link?: boolean } = {}) {
  const start = opts.link
    ? await call("/link-social", { cookie: opts.session, body: { provider, callbackURL: "/settings?connected=snaptrade" } })
    : await call("/sign-in/social", { body: { provider, callbackURL: "/hub" } });
  expect(start.status).toBe(200);
  const cookie = [opts.session, cookiesOf(start)].filter(Boolean).join("; ");
  return { url: new URL((await start.json()).url), cookie };
}

/** Starts "Sign in with SnapTrade" and returns the authorization URL and the state cookies. */
const startSignIn = () => startFlow("snaptrade");

/** A full round trip through the provider; returns the callback response. */
async function oauthCallback(provider: Provider, identity: Identity, opts: { session?: string; link?: boolean } = {}) {
  const { url, cookie } = await startFlow(provider, opts);
  pendingNonce = url.searchParams.get("nonce") ?? "";
  nextIdToken = (nonce) =>
    signJwt(
      {
        iss: ISSUER[provider],
        aud: AUDIENCE[provider],
        sub: identity.sub,
        ...(nonce && { nonce }),
        iat: Math.floor(Date.now() / 1000),
        auth_time: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        ...(identity.email !== undefined && { email: identity.email, email_verified: identity.emailVerified ?? true }),
        ...(identity.name !== undefined && { name: identity.name }),
        ...identity.claims,
      },
      identity.key,
    );
  return call(`/callback/${provider}?code=c${++code}&state=${url.searchParams.get("state")}`, { cookie });
}

const snaptradeCallback = (identity: Identity) => oauthCallback("snaptrade", identity);

async function signIn(provider: Provider, identity: Identity) {
  const response = await oauthCallback(provider, identity);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/hub");
  const cookie = sessionCookie(response);
  expect(cookie, "session cookie").toBeDefined();
  const session = await (await call("/get-session", { cookie })).json();
  return { userId: session.user.id as string, email: session.user.email as string, cookie: cookie! };
}

const snaptradeSignIn = (identity: Identity) => signIn("snaptrade", identity);
const googleSignIn = (identity: Identity) => signIn("google", identity);

/** "Connect with SnapTrade" from Settings for a signed-in user; returns the callback response. */
const linkSnapTrade = (session: string, identity: Identity) => oauthCallback("snaptrade", identity, { session, link: true });

/** A rejected sign-in redirects to the error page and sets no session. */
async function expectRejected(identity: Identity) {
  const response = await snaptradeCallback(identity);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toContain("error=");
  expect(sessionCookie(response)).toBeUndefined();
}

const providersOf = async (userId: string) =>
  (await db.select().from(s.accounts).where(eq(s.accounts.userId, userId))).map((a) => a.providerId).sort();

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
  auth = createAuth(db, env);
}, 60_000);

afterAll(async () => {
  vi.restoreAllMocks();
  await client?.close();
});

describe("demo sign-in", () => {
  it("creates the shared demo user once and signs the visitor in", async () => {
    const first = await demoSignIn();
    await demoSignIn();

    const users = await db.select().from(s.users).where(eq(s.users.id, DEMO_USER_ID));
    expect(users).toEqual([expect.objectContaining({ email: "demo@taxback.invalid", emailVerified: false })]);
    const [profile] = await db.select().from(s.userProfiles).where(eq(s.userProfiles.userId, DEMO_USER_ID));
    expect(profile?.isDemo).toBe(true);

    const session = await (await call("/get-session", { cookie: first })).json();
    expect(session.user.id).toBe(DEMO_USER_ID);
  });

  it("stores nothing that identifies a visitor and purges expired visitor sessions", async () => {
    await db
      .update(s.sessions)
      .set({ expiresAt: new Date("2020-01-01") })
      .where(eq(s.sessions.userId, DEMO_USER_ID));
    await demoSignIn();

    const sessions = await db.select().from(s.sessions).where(eq(s.sessions.userId, DEMO_USER_ID));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ ipAddress: null, userAgent: null });
  });

  it("rejects a cross-site request", async () => {
    const response = await auth.handler(
      new Request(`${BASE}/api/auth/demo/sign-in`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json", cookie: "x=1" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rate limits demo sign-ins per client", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await call("/demo/sign-in", { body: {}, ip: "10.9.9.9" })).status);
    expect(statuses.slice(0, 10).every((status) => status === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    // A different client is unaffected.
    expect((await call("/demo/sign-in", { body: {}, ip: "10.9.9.10" })).status).toBe(200);
  });
});

describe("shared demo account is read-only", () => {
  it.each([
    ["/list-sessions", undefined],
    ["/revoke-sessions", {}],
    ["/revoke-other-sessions", {}],
    ["/revoke-session", { token: "x" }],
    ["/update-user", { name: "Mine now" }],
    ["/change-email", { newEmail: "me@example.com" }],
    ["/delete-user", {}],
    ["/link-social", { provider: "snaptrade" }],
    ["/unlink-account", { providerId: "snaptrade" }],
    ["/list-accounts", undefined],
  ])("blocks %s", async (route, body) => {
    const cookie = await demoSignIn();
    const response = await call(route, { cookie, body });
    expect(response.status).toBe(403);
  });

  it("still lets the visitor sign out", async () => {
    const cookie = await demoSignIn();
    expect((await call("/sign-out", { cookie, body: {} })).status).toBe(200);
  });

  it("does not block a real user", async () => {
    const { cookie } = await snaptradeSignIn({ sub: "sub-someone", email: "someone@example.com" });
    const response = await call("/list-sessions", { cookie });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);
  });

  it("uses an allowlist, so unknown endpoints are blocked for the demo by default", () => {
    expect(isDemoAllowedPath("/get-session")).toBe(true);
    expect(isDemoAllowedPath("/callback/snaptrade")).toBe(true);
    expect(isDemoAllowedPath("/some-future-endpoint")).toBe(false);
  });
});

describe("Sign in with SnapTrade", () => {
  it("asks for read-only access with PKCE, state, and nonce", async () => {
    const { url } = await startSignIn();
    expect(url.origin + url.pathname).toBe("https://dashboard.snaptrade.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE}/api/auth/callback/snaptrade`);
    expect(url.searchParams.get("scope")?.split(" ").sort()).toEqual(["email", "openid", "profile", "read"]);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("nonce")).toBeTruthy();
  });

  it("creates a user keyed on the SnapTrade sub, with a lowercase email and a profile", async () => {
    const { userId, email } = await snaptradeSignIn({ sub: "sub-mixed", email: "Mixed.Case@Example.com", name: "Mia" });
    expect(email).toBe("mixed.case@example.com");
    const [account] = await db.select().from(s.accounts).where(eq(s.accounts.userId, userId));
    expect(account).toMatchObject({ providerId: "snaptrade", accountId: "sub-mixed" });
    const [profile] = await db.select().from(s.userProfiles).where(eq(s.userProfiles.userId, userId));
    expect(profile).toMatchObject({ isDemo: false });
  });

  it("exchanges the code with HTTP Basic client auth and the PKCE verifier", async () => {
    await snaptradeSignIn({ sub: "sub-pkce", email: "pkce@example.com" });
    const last = tokenRequests.at(-1)!;
    expect(last.authorization).toBe(`Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`);
    expect(last.body.get("code_verifier")).toBeTruthy();
    expect(last.body.get("client_secret")).toBeNull();
  });

  it("signs a returning user in to the same account", async () => {
    const first = await snaptradeSignIn({ sub: "sub-return", email: "return@example.com" });
    const second = await snaptradeSignIn({ sub: "sub-return", email: "return@example.com" });
    expect(second.userId).toBe(first.userId);
    expect(await db.select().from(s.accounts).where(eq(s.accounts.accountId, "sub-return"))).toHaveLength(1);
  });

  it("works when the user declines the email scope", async () => {
    const { userId, email } = await snaptradeSignIn({ sub: "SUB-NoEmail" });
    expect(email).toBe(placeholderEmail("SUB-NoEmail"));
    const [user] = await db.select().from(s.users).where(eq(s.users.id, userId));
    expect(user).toMatchObject({ emailVerified: false, name: "SnapTrade user" });
  });

  it("stores the SnapTrade tokens encrypted, readable only by server code", async () => {
    const { userId, cookie } = await snaptradeSignIn({ sub: "sub-tokens", email: "tokens@example.com" });
    const [account] = await db.select().from(s.accounts).where(eq(s.accounts.userId, userId));
    expect(account?.accessToken).toBeTruthy();
    expect(account?.accessToken).not.toContain("st-access-");
    expect(account?.refreshToken).not.toContain("st-refresh-");

    // The browser cannot fetch them, even for its own account.
    for (const route of ["/get-access-token", "/refresh-token"]) {
      const response = await call(route, { cookie, body: { accountId: account!.id } });
      expect(response.status, route).toBe(404);
    }
    // Server code can, through `auth.api` (no HTTP request).
    const { accessToken } = await auth.api.getAccessToken({ body: { accountId: account!.id, userId } });
    expect(accessToken).toMatch(/^st-access-c\d+$/);
  });

  it("rejects an id_token signed by any other key", async () => {
    await expectRejected({ sub: "sub-forged", email: "forged@example.com", key: strangerKey.privateKey });
  });

  it("rejects an id_token issued to another app", async () => {
    await expectRejected({ sub: "sub-aud", email: "aud@example.com", claims: { aud: "someone-else" } });
  });

  it("rejects an id_token from another issuer", async () => {
    await expectRejected({ sub: "sub-iss", email: "iss@example.com", claims: { iss: "https://evil.example" } });
  });

  it("rejects an id_token replayed from another sign-in (nonce mismatch)", async () => {
    await expectRejected({ sub: "sub-nonce", email: "nonce@example.com", claims: { nonce: "stale" } });
  });

  it("rejects an expired id_token", async () => {
    await expectRejected({ sub: "sub-exp", email: "exp@example.com", claims: { exp: Math.floor(Date.now() / 1000) - 60 } });
  });

  it("rejects a callback whose state was not issued to this browser", async () => {
    const { url } = await startSignIn();
    const response = await call(`/callback/snaptrade?code=c${++code}&state=${url.searchParams.get("state")}`);
    expect(response.headers.get("location")).toContain("error=");
    expect(sessionCookie(response)).toBeUndefined();
  });

  it("refuses an identity that carries the demo email", async () => {
    await expectRejected({ sub: "sub-imposter", email: "Demo@TaxBack.invalid" });
    expect(await db.select().from(s.accounts).where(eq(s.accounts.userId, DEMO_USER_ID))).toEqual([]);
  });

  it("never links an OAuth account to the demo user, whatever path creates it", async () => {
    await demoSignIn();
    const ctx = await auth.$context;
    await expect(ctx.internalAdapter.linkAccount({ userId: DEMO_USER_ID, providerId: "snaptrade", accountId: "x" })).rejects.toThrow(
      /demo account cannot be linked/,
    );
  });

  it("resolves each session cookie to its own user only, and rejects a forged one", async () => {
    const a = await snaptradeSignIn({ sub: "sub-a", email: "a@example.com" });
    const b = await snaptradeSignIn({ sub: "sub-b", email: "b@example.com" });
    expect(a.userId).not.toBe(b.userId);
    expect((await (await call("/get-session", { cookie: a.cookie })).json()).user.id).toBe(a.userId);
    expect((await (await call("/get-session", { cookie: b.cookie })).json()).user.id).toBe(b.userId);
    const forged = a.cookie.replace(/\.[^.]+$/, ".forged");
    expect(await (await call("/get-session", { cookie: forged })).json()).toBeNull();
  });
});

describe("Google sign-in, then Connect with SnapTrade", () => {
  it("signs a new user up with Google, with no SnapTrade grant yet", async () => {
    const { userId, email } = await googleSignIn({ sub: "g-new", email: "New.User@Gmail.com", name: "New User" });
    expect(email).toBe("new.user@gmail.com");
    expect(await providersOf(userId)).toEqual(["google"]);
    const [profile] = await db.select().from(s.userProfiles).where(eq(s.userProfiles.userId, userId));
    expect(profile).toMatchObject({ isDemo: false });
  });

  it("connects SnapTrade to the signed-in Google user, even with a different email", async () => {
    const google = await googleSignIn({ sub: "g-link", email: "pat@gmail.com", name: "Pat" });
    const response = await linkSnapTrade(google.cookie, { sub: "st-link", email: "pat.work@example.com", name: "Patricia" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/settings?connected=snaptrade");

    expect(await providersOf(google.userId)).toEqual(["google", "snaptrade"]);
    // The link keeps the Google identity: name and email are not rewritten.
    const [user] = await db.select().from(s.users).where(eq(s.users.id, google.userId));
    expect(user).toMatchObject({ name: "Pat", email: "pat@gmail.com" });

    // Signing in with SnapTrade afterwards lands on the same TaxBack account.
    const again = await snaptradeSignIn({ sub: "st-link", email: "pat.work@example.com" });
    expect(again.userId).toBe(google.userId);
  });

  it("connects SnapTrade when the user declines the email scope", async () => {
    const google = await googleSignIn({ sub: "g-noemail", email: "quiet@gmail.com" });
    const response = await linkSnapTrade(google.cookie, { sub: "st-noemail" });
    expect(response.headers.get("location")).toBe("/settings?connected=snaptrade");
    expect(await providersOf(google.userId)).toEqual(["google", "snaptrade"]);
  });

  it("refuses to connect a SnapTrade identity that already belongs to another TaxBack user", async () => {
    const owner = await snaptradeSignIn({ sub: "st-owned", email: "owner@example.com" });
    const other = await googleSignIn({ sub: "g-other", email: "other@gmail.com" });
    const response = await linkSnapTrade(other.cookie, { sub: "st-owned", email: "owner@example.com" });
    expect(response.headers.get("location")).toContain("error=");
    expect(await providersOf(other.userId)).toEqual(["google"]);
    expect(await providersOf(owner.userId)).toEqual(["snaptrade"]);
  });

  it("never merges accounts by email at sign-in, even when both emails are verified", async () => {
    const google = await googleSignIn({ sub: "g-merge", email: "same@example.com" });
    const response = await snaptradeCallback({ sub: "st-merge", email: "same@example.com", emailVerified: true });
    expect(response.headers.get("location")).toContain("error=account_not_linked");
    expect(sessionCookie(response)).toBeUndefined();
    expect(await providersOf(google.userId)).toEqual(["google"]);
  });

  it("does not let an unverified SnapTrade email take over a Google account", async () => {
    const google = await googleSignIn({ sub: "g-victim", email: "victim@gmail.com" });
    const response = await snaptradeCallback({ sub: "st-attacker", email: "victim@gmail.com", emailVerified: false });
    expect(response.headers.get("location")).toContain("error=");
    expect(sessionCookie(response)).toBeUndefined();
    expect(await providersOf(google.userId)).toEqual(["google"]);
  });

  it("requires a signed-in session to connect SnapTrade", async () => {
    const response = await call("/link-social", { body: { provider: "snaptrade", callbackURL: "/settings" } });
    expect(response.status).toBe(401);
  });

  // Google's id_token arrives straight from Google's token endpoint over TLS in exchange for the client
  // secret, which OIDC Core 3.1.3.7 accepts in place of a signature check, so Better Auth does not verify
  // it there. What an attacker can try is a callback with someone else's state (login CSRF).
  it("rejects a Google callback whose state was not issued to this browser", async () => {
    const { url } = await startFlow("google");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    const response = await call(`/callback/google?code=c${++code}&state=${url.searchParams.get("state")}`);
    expect(response.headers.get("location")).toContain("error=");
    expect(sessionCookie(response)).toBeUndefined();
  });
});
