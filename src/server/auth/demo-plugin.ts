import "server-only";
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { and, eq, lt } from "drizzle-orm";
import type { AnyDb } from "@/server/db/types";
import * as s from "@/server/db/schema";

/*
 * One shared demo user that every visitor signs in as, so the demo and real accounts run the same
 * code paths. Because the account is shared, a demo session may only read: any auth endpoint that
 * lists, changes, or revokes something would let one visitor see or disturb the others.
 * The seed fills this user's data under the same fixed id.
 */

export const DEMO_USER_ID = "demo";

/**
 * The only auth endpoints a demo session may call. An allowlist, so endpoints added by a Better Auth
 * upgrade are blocked for the demo by default instead of exposed by default.
 */
const DEMO_ALLOWED_PATHS = new Set(["/get-session", "/sign-out", "/demo/sign-in", "/sign-in/social", "/ok", "/error"]);

export function isDemoAllowedPath(path: string): boolean {
  return DEMO_ALLOWED_PATHS.has(path) || path.startsWith("/callback/");
}

/** Creates the demo user and its profile if missing; safe to call on every demo sign-in. */
export async function ensureDemoUser(db: AnyDb, email: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(s.users)
      .values({ id: DEMO_USER_ID, name: "Demo visitor", email, emailVerified: false })
      .onConflictDoNothing({ target: s.users.id });
    await tx
      .insert(s.userProfiles)
      .values({ userId: DEMO_USER_ID, isDemo: true })
      .onConflictDoUpdate({ target: s.userProfiles.userId, set: { isDemo: true } });
  });
}

export function demoPlugin(options: { db: AnyDb; demoEmail: string }) {
  const { db, demoEmail } = options;
  return {
    id: "demo",
    endpoints: {
      demoSignIn: createAuthEndpoint("/demo/sign-in", { method: "POST" }, async (ctx) => {
        await ensureDemoUser(db, demoEmail);
        // Every visitor adds a session row to the same user; drop the expired ones as we go.
        await db
          .delete(s.sessions)
          .where(and(eq(s.sessions.userId, DEMO_USER_ID), lt(s.sessions.expiresAt, new Date())));

        const user = await ctx.context.internalAdapter.findUserById(DEMO_USER_ID);
        if (!user) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Demo user is missing" });
        // Visitors share this user, so never store anything that identifies one of them.
        const session = await ctx.context.internalAdapter.createSession(DEMO_USER_ID, false, {
          ipAddress: null,
          userAgent: null,
        });
        if (!session) throw new APIError("INTERNAL_SERVER_ERROR", { message: "Could not start a demo session" });

        await setSessionCookie(ctx, { session, user });
        return ctx.json({ ok: true });
      }),
    },
    hooks: {
      before: [
        {
          matcher: (ctx) => !isDemoAllowedPath(ctx.path ?? ""),
          handler: createAuthMiddleware(async (ctx) => {
            const current = await getSessionFromCtx(ctx, { disableRefresh: true });
            if (current?.user.id === DEMO_USER_ID) {
              throw new APIError("FORBIDDEN", { message: "The shared demo account is read-only." });
            }
          }),
        },
      ],
    },
    rateLimit: [{ pathMatcher: (path) => path === "/demo/sign-in", window: 60, max: 10 }],
  } satisfies BetterAuthPlugin;
}
