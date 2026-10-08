/*
 * Read-only data health check: `pnpm db:audit`. It never writes, and it prints counts and short ids
 * only, never names, emails, amounts or account numbers. Each check is something that would make a
 * number on screen wrong or stale, so any non-zero line is worth a look.
 */
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = neon(url);

interface Check {
  name: string;
  query: string;
}

const CHECKS: Check[] = [
  {
    name: "Users (demo / real)",
    query: `SELECT count(*) FILTER (WHERE is_demo) AS demo, count(*) FILTER (WHERE NOT is_demo) AS real FROM user_profiles`,
  },
  {
    name: "Sync runs, last 30 days, by status",
    query: `SELECT status, trigger, count(*) FROM sync_runs WHERE started_at > now() - interval '30 days' GROUP BY 1, 2 ORDER BY 1, 2`,
  },
  {
    name: "Most recent failure messages",
    query: `SELECT left(user_id, 8) AS user, started_at::date AS day, stats->>'errorCode' AS code, left(error, 140) AS error
            FROM sync_runs WHERE status = 'failed' ORDER BY started_at DESC LIMIT 8`,
  },
  {
    name: "Syncs stuck in running for over 10 minutes",
    query: `SELECT left(user_id, 8) AS user, started_at FROM sync_runs WHERE status = 'running' AND started_at < now() - interval '10 minutes'`,
  },
  {
    name: "Real users with a SnapTrade grant but no successful sync in 2 days",
    query: `SELECT left(a.user_id, 8) AS user, max(r.finished_at) FILTER (WHERE r.status = 'succeeded') AS last_ok
            FROM accounts a LEFT JOIN sync_runs r ON r.user_id = a.user_id
            WHERE a.provider_id = 'snaptrade' GROUP BY a.user_id
            HAVING coalesce(max(r.finished_at) FILTER (WHERE r.status = 'succeeded'), 'epoch') < now() - interval '2 days'`,
  },
  {
    name: "Account types still unconfirmed (real users)",
    query: `SELECT left(b.user_id, 8) AS user, count(*) FROM brokerage_accounts b JOIN user_profiles p ON p.user_id = b.user_id
            WHERE NOT p.is_demo AND b.account_type_confirmed_at IS NULL AND b.kind = 'investment' GROUP BY 1`,
  },
  {
    name: "Ledger vs broker reconciliation, by status",
    query: `SELECT p.is_demo AS demo, r.status, count(*) FROM position_reconciliations r JOIN user_profiles p ON p.user_id = r.user_id GROUP BY 1, 2 ORDER BY 1, 2`,
  },
  {
    name: "Tax warnings, by type",
    query: `SELECT p.is_demo AS demo, w.type, count(*) FROM tax_warnings w JOIN user_profiles p ON p.user_id = w.user_id GROUP BY 1, 2 ORDER BY 1, 2`,
  },
  {
    name: "Foreign-currency transactions with no Bank of Canada rate within 7 days before the trade",
    query: `SELECT t.currency, count(*) FROM transactions t
            WHERE t.currency <> 'CAD' AND NOT EXISTS (
              SELECT 1 FROM fx_rates f WHERE f.currency = t.currency AND f.rate_date <= t.trade_date AND f.rate_date > t.trade_date - 7)
            GROUP BY 1`,
  },
  {
    // A sale at $0 is real (a delisted or worthless holding); a negative price or no units is not.
    name: "Buys or sells with no units or a negative price",
    query: `SELECT kind, count(*) FROM transactions WHERE kind IN ('buy', 'sell') AND (price < 0 OR quantity <= 0) GROUP BY 1`,
  },
  {
    name: "Settlement before trade date",
    query: `SELECT count(*) FROM transactions WHERE settlement_date < trade_date`,
  },
  {
    name: "Negative holdings",
    query: `SELECT count(*) FROM holdings WHERE quantity < 0`,
  },
  {
    name: "Holdings with no price (valued as unknown)",
    query: `SELECT p.is_demo AS demo, count(*) FROM holdings h JOIN user_profiles p ON p.user_id = h.user_id WHERE h.price IS NULL OR h.market_value IS NULL GROUP BY 1`,
  },
  {
    // Only non-registered activity produces tax years; a TFSA-only user rightly has none.
    name: "Users with non-registered activity but no tax-year results (recompute never ran)",
    query: `SELECT left(t.user_id, 8) AS user FROM transactions t
            JOIN brokerage_accounts b ON b.id = t.account_id AND b.account_type = 'non_registered'
            WHERE NOT EXISTS (SELECT 1 FROM tax_year_summaries s WHERE s.user_id = t.user_id)
            GROUP BY t.user_id`,
  },
  {
    name: "Expired sessions not yet cleaned up",
    query: `SELECT count(*) FROM sessions WHERE expires_at < now()`,
  },
];

async function main() {
  let flagged = 0;
  for (const check of CHECKS) {
    try {
      const rows = (await sql.query(check.query)) as Record<string, unknown>[];
      const empty = rows.length === 0 || (rows.length === 1 && Object.values(rows[0]!).every((v) => v === 0 || v === "0"));
      console.log(`\n${empty ? "ok  " : "··  "}${check.name}`);
      if (!empty) {
        flagged++;
        console.table(rows);
      }
    } catch (error) {
      flagged++;
      console.log(`\n!!  ${check.name}: ${(error as Error).message}`);
    }
  }
  console.log(`\n${flagged} of ${CHECKS.length} checks returned rows to review.`);
}

void main();
