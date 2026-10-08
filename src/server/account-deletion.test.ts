import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { setTokenUtil } from "better-auth/oauth2";
import { eq } from "drizzle-orm";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Auth, createAuth } from "@/server/auth/config";
import * as s from "@/server/db/schema";
import { RevokeFailedError, SNAPTRADE_REVOKE_URL, deleteUserData } from "./account-deletion";

const credentials = { clientId: "st-client", clientSecret: "st-secret" };
const env = {
  BETTER_AUTH_SECRET: "test-secret-that-is-at-least-32-characters",
  BETTER_AUTH_URL: "http://localhost:3000",
  DEMO_USER_EMAIL: "demo@taxback.invalid",
  SNAPTRADE_OAUTH_CLIENT_ID: credentials.clientId,
  SNAPTRADE_OAUTH_CLIENT_SECRET: credentials.clientSecret,
};

let client: PGlite;
let db: PgliteDatabase<typeof s>;
let auth: Auth;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  auth = createAuth(db, env);
});

afterAll(async () => {
  await client.close();
});

/** A user holding a SnapTrade grant whose tokens are stored exactly as Better Auth stores them (encrypted). */
async function userWithGrant(id: string) {
  const ctx = (await auth.$context) as unknown as Parameters<typeof setTokenUtil>[1];
  await db.insert(s.users).values({ id, name: "Test", email: `${id}@example.com`, emailVerified: true });
  await db.insert(s.accounts).values({
    id: `${id}-grant`,
    userId: id,
    accountId: `sub-${id}`,
    providerId: "snaptrade",
    accessToken: await setTokenUtil(`access-${id}`, ctx),
    refreshToken: await setTokenUtil(`refresh-${id}`, ctx),
  });
}

const stillThere = async (id: string) => (await db.select().from(s.users).where(eq(s.users.id, id))).length === 1;

describe("deleteUserData", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("revokes the decrypted refresh token with the app's credentials, then deletes the user", async () => {
    await userWithGrant("u1");
    const calls: Request[] = [];
    const fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return new Response(null, { status: 200 });
    });
    const order: string[] = [];

    await deleteUserData(db, auth, "u1", credentials, fetchStub as typeof fetch, async () => {
      order.push(`signed out, user present: ${await stillThere("u1")}`);
    });

    expect(calls).toHaveLength(1);
    const [request] = calls;
    expect(request!.url).toBe(SNAPTRADE_REVOKE_URL);
    expect(request!.method).toBe("POST");
    expect(request!.headers.get("authorization")).toBe(`Basic ${Buffer.from("st-client:st-secret").toString("base64")}`);
    const body = new URLSearchParams(await request!.text());
    expect(body.get("token")).toBe("refresh-u1");
    expect(body.get("token_type_hint")).toBe("refresh_token");

    expect(order).toEqual(["signed out, user present: true"]);
    expect(await stillThere("u1")).toBe(false);
    expect(await db.select().from(s.accounts).where(eq(s.accounts.userId, "u1"))).toEqual([]);
  });

  it("deletes nothing when SnapTrade refuses or cannot be reached", async () => {
    await userWithGrant("u2");
    await expect(
      deleteUserData(db, auth, "u2", credentials, (async () => new Response(null, { status: 503 })) as typeof fetch),
    ).rejects.toBeInstanceOf(RevokeFailedError);
    await expect(
      deleteUserData(db, auth, "u2", credentials, (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch),
    ).rejects.toBeInstanceOf(RevokeFailedError);
    expect(await stillThere("u2")).toBe(true);
  });

  it("refuses to orphan a grant when the app has no SnapTrade credentials", async () => {
    await userWithGrant("u3");
    await expect(deleteUserData(db, auth, "u3", null)).rejects.toBeInstanceOf(RevokeFailedError);
    expect(await stillThere("u3")).toBe(true);
  });

  it("deletes a Google-only user without calling SnapTrade", async () => {
    await db.insert(s.users).values({ id: "u4", name: "Test", email: "u4@example.com", emailVerified: true });
    const fetchStub = vi.fn();
    await deleteUserData(db, auth, "u4", null, fetchStub as unknown as typeof fetch);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await stillThere("u4")).toBe(false);
  });
});
