# Test Report: Sign-in and Sync

Submission commit: `6d4e352` (tip of `main`).
This report contains no credentials, secrets, account identifiers, or personal financial data.

Note: the SnapTrade consent screen shows "University of New Brunswick" as the app name.
That is a mistake in the name we gave our SnapTrade workspace, not a different app.

## 1. Live end-to-end run (2026-10-06)

Setup: a live SnapTrade Test OAuth app, a SnapTrade Personal account, and the **SnapTrade Sandbox** brokerage (synthetic data, no real money).

| Step | Result |
| --- | --- |
| "Continue with SnapTrade" | Sign-in, read-only grant (`openid email profile read`), and first sync completed in one consent |
| Accounts imported | 3 |
| Transactions imported | 18 |
| Holdings imported | 12 |
| Account type guess | The Sandbox IRA was guessed as `us_retirement` (excluded from gains, kept for superficial-loss checks) |
| Missing history | A position with no purchase history raised `opening_balance_needed` |

The Sandbox returns almost every activity type, so this run found issues that our stubbed tests had missed. We fixed them afterwards:

- **Null `settlement_date`:** SnapTrade sets it only on trades, so dividends, fees, splits, and transfers failed. The mapper now falls back to the trade date (`src/server/snaptrade/map.ts`, with a test in `map.test.ts`).
- **Dropped activity types:**
  - `RETURN_OF_CAPITAL` and `INTERNAL_ASSET_TRANSFER_IN` / `_OUT` were mapped on 2026-10-06.
  - `REVERSE_SPLIT` and the matching of `TAX` withholding to dividends were fixed on 2026-10-07.
  - `SPINOFF` and `STOCK_MERGER` are still skipped by design; users enter these as corporate actions.

We recorded this run in our development log at the time. That log was removed from `main` in the submission commit but is still in the history; this is the commit just before it: [`docs/progress.md` at `d7eb679`, lines 107-112](https://github.com/TonyDeDev/tax-back/blob/d7eb679/docs/progress.md#L107-L112).

## 2. Screenshots on the live deployment (2026-10-10)

We took these on tax-back.vercel.app with the SnapTrade Sandbox brokerage.
Amounts are hidden with TaxBack's hide-amounts toggle, and we blurred names, connection IDs, and per-security rows.

| Screenshot | Step |
| --- | --- |
| `Screenshot (251).png` | Sign in page: click **Continue with SnapTrade** |
| `Screenshot (252).png` | SnapTrade consent screen: sign-in, name, email, and read-only account data, with no trading. Click **Allow access** |
| `Screenshot (269).png` | Back in TaxBack, the Hub filtered to SnapTrade Sandbox shows "Synced just now" with value history and allocation |
| `Screenshot (270).png` | The Tax Center computes 2026 results from the synced ledger |

The alerts are positions whose purchase history is incomplete in the Sandbox data.
TaxBack flags each one and asks for an opening balance, as in the 2026-10-06 run above.

## 3. Real brokerage run

The mapper was also run once against a real Wealthsimple connection, as noted in `docs/tax-rules.md` (Known Limits).
We are not sharing any output from that run because it contains personal financial data.
No other real-brokerage runs have been done.

## 4. Automated tests

SnapTrade and the Bank of Canada are stubbed, and the database is in-memory Postgres (PGlite).
These five suites cover sign-in and sync and were run at `6d4e352` on 2026-10-10: 122 of 122 tests passed.
The full suite (`pnpm test`) passed 403 of 403 tests.

| Suite | Covers |
| --- | --- |
| `src/server/auth/auth.test.ts` | Sign in with SnapTrade: PKCE, state, and nonce; rejects id_tokens with a wrong key, audience, issuer, nonce, or expiry; identity keyed on `sub`; email scope declined; tokens stored encrypted; Google sign-in then Connect with SnapTrade; no merging accounts by email; read-only demo account |
| `src/server/auth/snaptrade-provider.test.ts` | Mapping id_token claims to a user |
| `src/server/snaptrade/client.test.ts` | Bearer-only auth; following activity pages to the end; retries and rate limits; tokens never appear in errors |
| `src/server/snaptrade/map.test.ts` | Mapping SnapTrade accounts, positions, balances, and activity types to the ledger |
| `src/server/sync/sync.test.ts` | Full sync and recompute; re-running is safe; 15-minute Refresh limit; refresh once on a `401` and retry; reconnect prompt when the refresh fails; keeps the last good data when SnapTrade is down; keeps users apart; one sync at a time per user |

To reproduce:

```
pnpm install
pnpm exec vitest run src/server/auth src/server/sync src/server/snaptrade
```
