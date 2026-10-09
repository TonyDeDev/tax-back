import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import type { AnyDb } from "@/server/db/types";
import * as s from "@/server/db/schema";
import type { Env } from "@/server/env";
import { DEMO_USER_ID, demoPlugin } from "./demo-plugin";
import { SNAPTRADE_PROVIDER_ID, snaptradeProvider } from "./snaptrade-provider";

export type AuthEnv = Pick<
  Env,
  | "BETTER_AUTH_SECRET"
  | "BETTER_AUTH_URL"
  | "DEMO_USER_EMAIL"
  | "GOOGLE_CLIENT_ID"
  | "GOOGLE_CLIENT_SECRET"
  | "SNAPTRADE_OAUTH_CLIENT_ID"
  | "SNAPTRADE_OAUTH_CLIENT_SECRET"
>;

/** Which sign-in providers have credentials; the UI disables the others. */
export function configuredProviders(env: AuthEnv) {
  return {
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    snaptrade: Boolean(env.SNAPTRADE_OAUTH_CLIENT_ID && env.SNAPTRADE_OAUTH_CLIENT_SECRET),
  };
}

/**
 * Endpoints that hand out a user's SnapTrade OAuth tokens or provider data. Server code may call them
 * through `auth.api` (no HTTP request); the browser never may, so tokens never reach client JavaScript.
 */
const SERVER_ONLY_PATHS = new Set(["/get-access-token", "/refresh-token", "/account-info"]);

/** A factory rather than a module singleton, so tests can run the real config against PGlite. */
export function createAuth(db: AnyDb, env: AuthEnv) {
  const providers = configuredProviders(env);
  return betterAuth({
    appName: "Snap Tax Back",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "pg", usePlural: true, schema: s }),
    socialProviders: {
      ...(providers.google && {
        google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! },
      }),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
    user: {
      // Second lock on the demo account: no provider identity may ever carry its email.
      validateUserInfo: ({ user }) => {
        if (user.email?.toLowerCase() === env.DEMO_USER_EMAIL) {
          return { error: "email_reserved", errorDescription: "This email is reserved." };
        }
      },
    },
    account: {
      // The SnapTrade access and refresh tokens are the keys to the user's brokerage data.
      encryptOAuthTokens: true,
      /*
       * A Google user connects SnapTrade later, from Settings, while signed in ("Connect with SnapTrade").
       * - Only that explicit link exists. Implicit linking by matching email at sign-in is off: it would
       *   let someone who registers a SnapTrade account under a victim's email be merged into the
       *   victim's TaxBack account. A sign-in whose email already has an account gets `account_not_linked`.
       * - SnapTrade is trusted for the explicit link, so it works when the user declined the email scope
       *   or uses a different address: being signed in and approving SnapTrade's consent is the proof.
       */
      accountLinking: {
        enabled: true,
        disableImplicitLinking: true,
        trustedProviders: [SNAPTRADE_PROVIDER_ID],
        allowDifferentEmails: true,
        // Keep the Google name and picture; a link must not rewrite who the user is.
        updateUserInfoOnLink: false,
      },
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 100 },
    // Better Auth turns both checks off when NODE_ENV is "test"; pin them so tests exercise production behaviour.
    advanced: { disableOriginCheck: false, disableCSRFCheck: false },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.request && SERVER_ONLY_PATHS.has(ctx.path)) {
          throw new APIError("NOT_FOUND");
        }
      }),
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await db.insert(s.userProfiles).values({ userId: user.id }).onConflictDoNothing();
          },
        },
      },
      account: {
        create: {
          before: async (account) => {
            if (account.userId === DEMO_USER_ID) {
              throw new APIError("FORBIDDEN", { message: "The shared demo account cannot be linked." });
            }
          },
        },
      },
    },
    plugins: [
      demoPlugin({ db, demoEmail: env.DEMO_USER_EMAIL }),
      genericOAuth({
        config: providers.snaptrade
          ? [snaptradeProvider(env.SNAPTRADE_OAUTH_CLIENT_ID!, env.SNAPTRADE_OAUTH_CLIENT_SECRET!)]
          : [],
      }),
      // `nextCookies` must stay last so it sees cookies set by the plugins before it.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
