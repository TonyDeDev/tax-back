import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(16),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  SNAPTRADE_CLIENT_ID: z.string().optional(),
  SNAPTRADE_CONSUMER_KEY: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  CRON_SECRET: z.string().optional(),
  DEMO_USER_EMAIL: z.string().email().default("demo@taxback.app"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Server-only: parse lazily so builds and tests that never touch env still work. */
export function getEnv(): Env {
  cached ??= schema.parse(process.env);
  return cached;
}
