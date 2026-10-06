/*
 * Dev tool: calls the SnapTrade read endpoints with a user's stored OAuth token and saves the raw
 * responses to `.snaptrade-probe/` (gitignored), so response shapes can be checked against the zod
 * schemas. The output is real brokerage data: never commit it or paste it anywhere.
 *
 *   pnpm snaptrade:probe            lists users with a SnapTrade grant
 *   pnpm snaptrade:probe <userId>   probes that user's accounts
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { createAuth } from "@/server/auth/config";
import { SNAPTRADE_PROVIDER_ID } from "@/server/auth/snaptrade-provider";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { getEnv } from "@/server/env";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const BASE = "https://api.snaptrade.com/api/v1";
const OUT = ".snaptrade-probe";

async function get(token: string, path: string): Promise<unknown> {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await res.text();
  console.log(`${res.status} GET ${path} (${text.length} bytes)`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function save(name: string, body: unknown) {
  writeFileSync(`${OUT}/${name}.json`, JSON.stringify(body, null, 2));
}

async function main() {
  const db = getDb();
  const userId = process.argv[2];

  if (!userId) {
    const rows = await db
      .select({ userId: s.accounts.userId, email: s.users.email })
      .from(s.accounts)
      .innerJoin(s.users, eq(s.users.id, s.accounts.userId))
      .where(eq(s.accounts.providerId, SNAPTRADE_PROVIDER_ID));
    console.table(rows);
    return;
  }

  const [grant] = await db
    .select({ id: s.accounts.id })
    .from(s.accounts)
    .where(and(eq(s.accounts.userId, userId), eq(s.accounts.providerId, SNAPTRADE_PROVIDER_ID)));
  if (!grant) throw new Error(`User ${userId} has no SnapTrade grant`);

  const auth = createAuth(db, getEnv());
  const { accessToken } = await auth.api.getAccessToken({ body: { accountId: grant.id, userId } });

  mkdirSync(OUT, { recursive: true });
  const accounts = await get(accessToken, "/accounts");
  save("accounts", accounts);
  save("authorizations", await get(accessToken, "/authorizations"));
  if (!Array.isArray(accounts)) return;

  for (const [i, account] of (accounts as { id: string }[]).entries()) {
    const base = `/accounts/${account.id}`;
    // `/positions` and `/holdings` answer 410 for OAuth apps; `/positions/all` replaces them.
    save(`account-${i}-positions`, await get(accessToken, `${base}/positions/all`));
    save(`account-${i}-balances`, await get(accessToken, `${base}/balances`));
    save(`account-${i}-activities`, await get(accessToken, `${base}/activities?limit=1000&offset=0`));
  }
  console.log(`Saved to ${OUT}/`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
