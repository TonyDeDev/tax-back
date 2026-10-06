import "server-only";
import { z } from "zod";

const optional = z.string().trim().min(1).optional();

/** Empty strings in `.env` files mean "not set", so they never pass a `min` check by accident. */
const blankToUndefined = (source: Record<string, string | undefined>) =>
  Object.fromEntries(Object.entries(source).map(([k, v]) => [k, v === "" ? undefined : v]));

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    /** Signs sessions and encrypts the stored SnapTrade OAuth tokens; rotating it signs everyone out. */
    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
    BETTER_AUTH_URL: z.url(),
    /** Google sign-in, for users who want to look around before setting up SnapTrade. */
    GOOGLE_CLIENT_ID: optional,
    GOOGLE_CLIENT_SECRET: optional,
    /** The SnapTrade OAuth app (Dashboard, then OAuth Apps): sign-in and brokerage access. */
    SNAPTRADE_OAUTH_CLIENT_ID: optional,
    SNAPTRADE_OAUTH_CLIENT_SECRET: optional,
    CRON_SECRET: z.string().min(32, "CRON_SECRET must be at least 32 characters").optional(),
    // `.invalid` is a reserved TLD, so no identity provider can ever verify this address and claim the demo user.
    DEMO_USER_EMAIL: z.email().toLowerCase().default("demo@taxback.invalid"),
  })
  .superRefine((env, ctx) => {
    const pairs = [
      ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
      ["SNAPTRADE_OAUTH_CLIENT_ID", "SNAPTRADE_OAUTH_CLIENT_SECRET"],
    ] as const;
    for (const [a, b] of pairs) {
      if ((env[a] === undefined) !== (env[b] === undefined)) {
        ctx.addIssue({ code: "custom", path: [env[a] ? b : a], message: `${a} and ${b} must be set together` });
      }
    }
  });

export type Env = z.infer<typeof schema>;

export function parseEnv(source: Record<string, string | undefined>): Env {
  return schema.parse(blankToUndefined(source));
}

let cached: Env | undefined;

/** Parsed lazily so builds and tests that never touch env still work. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
