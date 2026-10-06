/*
 * Creates or resets the "Try the demo" portfolio (`src/server/demo/seed.ts`).
 *
 *   pnpm db:seed
 *
 * Needs DATABASE_URL in `.env.local` and network access to the Bank of Canada for exchange rates.
 * The daily cron runs the same reset, so this is only needed for a fresh database.
 */
import { existsSync } from "node:fs";
import { seedDemo } from "@/server/demo/seed";
import { getDb } from "@/server/db";
import { torontoToday } from "@/server/recompute";
import { getEnv } from "@/server/env";

// tsx does not read Next's env files; load `.env.local` the way `next dev` would.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

if (process.argv.includes("--help")) {
  console.log("Usage: pnpm db:seed");
  process.exit(0);
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Add your Neon connection string to .env.local, then run pnpm db:migrate first.");
    process.exit(1);
  }
  const env = getEnv();
  const today = torontoToday();
  console.log(`Seeding the demo portfolio as of ${today}...`);
  await seedDemo(getDb(), today, { demoEmail: env.DEMO_USER_EMAIL });
  console.log("Done. Sign in with \"Try the demo\".");
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
