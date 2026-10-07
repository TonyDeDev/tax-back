# Progress

Status as of 2026-10-06.
The full plan is in the Claude plan file, and scope rules are in `CLAUDE.md`.

## Done

### Phase 0 - Scaffold and tooling

- Next.js (App Router), TypeScript strict, Tailwind v4, ESLint, and pnpm.
- Dependencies installed for Drizzle, Neon, Better Auth, SnapTrade, zod, decimal.js, Recharts, and TanStack Table.
- Vitest with coverage, plus Playwright installed for later smoke tests.
- Scripts: `dev`, `build`, `lint`, `typecheck`, `test`, and the `db:*` commands.
- `.env.example`, a zod env parser in `src/lib/env.ts`, and a GitHub Actions CI workflow.
- Placeholder `.env.local` (gitignored) waiting for the SnapTrade keys.

### Phase 2 - Tax engine (`src/tax-engine`)

- Pooled ACB across all non-registered accounts, including return of capital and splits.
- Capital gains in CAD, reported in the settlement-date year, at a 50% inclusion rate.
- Superficial loss with the least-of rule, 30-day boundaries, and lost-forever handling for registered replacements.
- Dividends split into eligible, non-eligible, and foreign.
- Harvesting opportunities with safe-sale and no-rebuy dates.
- Missing-history warnings and opening-balance overrides.
- 46 passing tests, about 98% line coverage.

### Phase 2a - Tax engine correctness pass

Four defects found by reading the engine, each reproduced as a failing test before being fixed:

- A denied superficial loss was allocated to in-window purchases in ledger order, so a pre-sale
  purchase consumed it first. When the sale emptied the pool the amount was reported
  `lost_forever` even though a non-registered replacement existed, understating that position's
  ACB. Allocation now prefers post-sale replacements, which are the shares actually still held.
- A split reported by two accounts was applied once per report to the pooled quantity and to the
  cross-account held timeline, so a 2-for-1 held at two brokerages gave 4x. Splits are now deduped
  per event, scoped to non-registered accounts for the pool and to all accounts for the timeline.
- Superficial losses inside the last 30 days were reported as settled, because the still-held test
  read current holdings as holdings at a future date. `SuperficialLoss.status` is now
  `pending` until the window closes, with a `superficial_loss_pending` warning.
- `fee` entries fell through the switch unhandled; the case is now explicit and documented.

### Phase 1 (partial) - UI scaffolding

- Red Hat fonts, `theme.css` tokens, and next-themes (system default, manual toggle).
- App shell: sidebar on desktop, top bar and bottom nav on phones.
- Shared components: Button, Card, Badge, Money, PageHeader, StatCard, EmptyState, DemoBadge.
- Placeholder pages for landing, sign-in, Hub, account detail, security detail, Tax Center, and Settings.
- Checked in dark and light at desktop and 390px width with no horizontal scroll.

### Phase 3 (partial) - Database schema

- Drizzle schema in `src/server/db/schema.ts` and Better Auth tables in `src/server/db/auth-schema.ts`; design notes in `docs/schema.md`.
- Migrations `0000_init`, `0001_auth_and_tenant_fks`, `0002_snaptrade_oauth`, and `0003_account_kind` applied to Neon.
- Row-to-engine mappers (`ledger.ts`) and a transactional derived-table writer (`derived.ts`).
- PGlite tests apply the real migrations and cover constraints, a full ledger round trip through `computeTax`, index use, cross-tenant references, and delete-my-data cascades.

### Phase 4 - Auth

- Better Auth with the Drizzle adapter (`src/server/auth/config.ts`): Google sign-in, and "Sign in with SnapTrade" as an OpenID Connect provider (`snaptrade-provider.ts`), each enabled when its credentials are set.
- Google users connect SnapTrade later from Settings ("Connect with SnapTrade", an explicit `linkSocial`); accounts are never merged by matching email.
- Sign-in and brokerage access are one SnapTrade consent (`openid email profile read`); id_tokens are verified against the SnapTrade JWKS, issuer, audience, expiry, and nonce, and users are keyed on `sub`.
- The SnapTrade tokens are stored encrypted, and the endpoints that return them are blocked over HTTP.
- One-click demo login as a Better Auth plugin endpoint (`POST /api/auth/demo/sign-in`), rate limited to 10 per minute per client with database-backed limits.
- `requireUser()`, `requireUserForAction()`, and `requireWritableUser()` in `src/server/auth/session.ts`; every app page calls `requireUser()`.
- `src/proxy.ts`: early redirect to sign-in without a session cookie, nonce-based CSP, and security headers.
- Sign-in page with Google and SnapTrade buttons and error states, a Settings card that connects or manages SnapTrade, demo button on the landing and sign-in pages, user menu and sign out in the shell.
- Setup and OAuth app instructions in `docs/setup.md`.
- Integration tests drive the real config through `auth.handler` on PGlite, including full Google and SnapTrade OIDC round trips against stubbed providers: forged signature, audience, issuer, nonce, expiry, and state tests, plus linking, ownership conflicts, and email-takeover attempts.

### Switch to SnapTrade OAuth (2026-10-05)

- GitHub sign-in, the Commercial `registerUser` flow, `snaptrade_users`, `ENCRYPTION_KEY`, and `snaptrade-typescript-sdk` (it has no OAuth mode) were removed.
- SnapTrade connection and account ids are now unique per user, since an OAuth connection can be shared.
- Google sign-in was kept so people can try TaxBack before setting up SnapTrade.
- Free testing was checked against https://docs.snaptrade.com/docs/oauth-apps.
  The Test app is free, needs no KYC, supports every scope and real brokerages, and allows 5 users.
  OAuth is a free preview, and SnapTrade says paid pricing will follow.

### Security audit (2026-10-05)

Fixed:

- The shared demo user could list other visitors' sessions (IP and user agent), revoke them, or change the account.
  Demo sessions now store no IP or user agent, and may only call an allowlist of auth endpoints.
- The demo email was claimable through OAuth account linking.
  It now uses the reserved `.invalid` domain, provider identities with that email are refused, and no OAuth account can be linked to the demo user.
- OAuth tokens were stored in plaintext; they are now encrypted.
- Derived tables referenced transactions and accounts by `id` alone; they now use `(id, user_id)` composite keys.
- Env validation was minimal and lived in the client-safe folder; it is now strict and in `src/server/env.ts`.
- No security headers; the proxy now sets a nonce CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and HSTS in production.
- Better Auth disables its origin and CSRF checks when `NODE_ENV` is `test`; the config pins them on so tests match production.
- The app shell was a full viewport tall under the demo badge, so every page scrolled by the badge height and the sidebar footer was clipped.

Recorded as rules for the sync phase in `docs/schema.md` ("Rules for Writers"): per-user upsert keys, stale sync lock recovery, security natural-key collisions, serialized refresh-token rotation, and decimal parsing at the SnapTrade boundary.

### Phase 8 - SnapTrade sync (2026-10-06)

- `src/server/snaptrade/`: Bearer-token client with zod-validated responses and full activity paging, token handling that refreshes once on a 401 and then asks the user to reconnect, and a pure mapper from SnapTrade to ledger rows.
- Endpoint paths checked against live OAuth responses with `pnpm snaptrade:probe`: `/positions` and `/holdings` answer 410, `/positions/all` replaces them.
- `src/server/fx/boc.ts`: Bank of Canada Valet rates, fetching only the missing range.
- `src/server/recompute.ts`: ledger to `computeTax` to the derived tables, for one user.
- `src/server/sync/sync.ts`: stale lock recovery, one running sync per user, the 15-minute Refresh cooldown, upserts on the per-user SnapTrade keys, adopting demo-only securities, and failures stored with a user-safe message.
- Cash accounts (Wealthsimple Cash, chequing) are synced for their balance (`brokerage_accounts.kind`, migration `0003_account_kind`); only credit cards are skipped.
  Generic broker names are replaced from SnapTrade's detailed type, so a Wealthsimple savings account shows as "Savings" rather than "Personal".
- Triggers: first sync after the grant (Hub and Settings), the Refresh button, and the daily cron (`/api/cron/sync`, which also deletes expired sessions).
- Tested on PGlite with SnapTrade and the Bank of Canada stubbed, and run once against a real Wealthsimple connection.
- 2026-10-06: run end to end against a live SnapTrade Test OAuth app and the SnapTrade Sandbox brokerage.
  "Continue with SnapTrade" signs in, grants access, and syncs in one consent; 3 accounts, 18
  transactions, and 12 holdings landed, the IRA was guessed as `us_retirement`, and a position with no
  purchase history raised `opening_balance_needed`. This found the null `settlement_date` bug and the
  dropped activity types listed under Open items.

### Phase 6 (partial) - Hub with real data

- Total value in CAD, YTD realized gains, estimated tax, and alerts from the derived tables.
- Accounts grouped by brokerage, with a type picker so the user confirms each account's type (which recomputes).
- Banner for a failed sync, with "Connect with SnapTrade" when the grant expired.

### Phase 2b - Complete event engine, audit trail, reconciliation, and sale preview (2026-10-06)

- Engine (`src/tax-engine`): stock dividends; transfers in kind paired across accounts (no event between
  non-registered accounts, deemed sale into a registered account with the loss denied for good,
  acquisition at fair market value out of one); spinoffs (ACB split by fair market value) and mergers
  (rollover, cash part is a disposition).
- Every ACB event records the rule applied and the Bank of Canada rate used (`AcbEvent.rule`, `fxRate`).
- `reconcile.ts`: the replayed ledger against broker positions, pooled non-registered per security and
  each registered account on its own.
- `preview.ts`: "what if I sell?" runs the engine with one hypothetical sale today, settling T+1.
- Migration `0004_audit_reconcile_corporate`: `corporate_actions`, `position_reconciliations`, and the
  audit columns on `acb_events`. It clears `acb_events` (a cache) so `rule` can be NOT NULL; the next
  sync, Refresh, or daily cron refills it.
- SnapTrade `STOCK_DIVIDEND` activities are now mapped instead of skipped.
- Security page: position, the ACB audit trail with receipts per step, ledger vs broker, the sale
  preview, opening balance, and corporate actions. Hub: investments table and "ledger matches broker
  positions: N%".
- Writes from the security page insert and recompute in one transaction, so a change the engine
  cannot compute is rolled back rather than leaving the results stuck.
- Tests: golden cases for every new event (`events.test.ts`), the sale preview (`preview.test.ts`),
  500 seeded random ledgers checking that shares are conserved in every account, ACB steps chain,
  corporate actions move ACB without creating any, and gains add up (`conservation.test.ts`), and a
  PGlite recompute and read-query test (`src/server/recompute.test.ts`).

### U.S. brokerages (2026-10-06)

- Interlisted shares are pooled as identical property: listings with the same share-class FIGI from
  SnapTrade, or linked by the user, map to one canonical security before the engine runs
  (`src/server/db/pools.ts`). The security page redirects any listing to the pooled page and shows
  its listings, with link and unlink.
- New `us_retirement` account type (IRA, Roth IRA, 401(k), 403(b), 457(b)), guessed from the broker and
  treated like a registered account.
- Dividend class follows the issuer: a U.S. listing pooled with a Canadian one is eligible, and the user
  can set the class per security.
- Migration `0005_interlisted_us_retirement`: `securities.figi_share_class`, `security_preferences`, and
  the new account type in the checks. Sync fills the FIGI on known securities.

### Phase 5 - Demo seed (2026-10-06)

- `src/server/demo/seed.ts`: three brokerages (Questrade, Wealthsimple, Charles Schwab), non-registered,
  TFSA, RRSP, Roth IRA, and a cash account, in CAD and USD, across three tax years, with dates relative
  to today. It exercises pooled ACB, DRIPs, return of capital, a TSX/NYSE interlisted pool, a pending
  superficial loss from a TFSA rebuy, a deemed sale into the TFSA, U.S. withholding, a transfer in
  closed by an opening balance, a harvesting suggestion, and one reconciliation gap (8 of 9 match).
- Exchange rates are real Bank of Canada rates; the seed never writes invented rates to the shared table.
- `pnpm db:seed` runs it; the daily cron resets it; the Hub seeds it on the first demo visit if neither has run.
- The Hub shows the demo's data, read-only.

### Phase 7 (partial) - Tax Center (2026-10-06)

- `src/server/queries/tax.ts`: the year list, and one read per year covering the summary, the realized
  gains, the superficial losses with their replacement purchases, the dividends, and the harvesting
  opportunities. Derived rows already carry canonical security ids, so each one links to its security page.
- `src/app/(app)/tax/[year]/page.tsx`: summary tiles, realized gains in the Schedule 3 order with a
  totals row, superficial losses with their 30-day windows and what happened to the denied amount,
  dividends by security and class, and harvesting for the year in progress.
- `/tax` redirects to the newest year with results, and the nav points there instead of a fixed 2026.
- `src/lib/tax-csv.ts` and `/tax/[year]/export`: a CSV per year, a section per table, totals taken from
  the saved year summary so the export never recomputes tax. Works in the read-only demo.
- Tests (293 total): the read queries over the seeded demo on PGlite, checking that the rows the page
  prints add up to the saved summary for every year, that registered accounts stay out of gains and
  income, and that the SHOP superficial loss carries its TFSA replacement; plus the CSV writer alone.

### Docs

- `docs/dev.md`: developer quick start.
- `docs/setup.md`: environment variables and the SnapTrade OAuth app.
- `docs/tax-rules.md`: rules implemented and known limits.
- `docs/schema.md`: tables, design decisions, rules for writers, query-to-index map, and what the schema supports.

## Not started

- Phase 1 remainder: data table, alert banner, and a styleguide route.
- Phase 6 remainder: allocation charts and the account detail page (the Hub does not link to it yet).
- Phase 7 remainder: Settings (marginal rate, delete my data) and the landing page.
  Nothing sets `user_profiles.marginal_rate` yet, so the Hub, the Tax Center, and the sale preview all
  say "needs your marginal tax rate" with no way to give one.
- Phases 9 and 10: quality pass and deploy.

## Open items

- **Activity types SnapTrade reports that the mapper drops.** Found on 2026-10-06 against the SnapTrade
  Sandbox, which returns one of almost every type. Each is counted in `sync_runs.stats.skipped` but
  raises no warning, so the numbers look complete when they are not:
  - ~~`RETURN_OF_CAPITAL`~~ and ~~`INTERNAL_ASSET_TRANSFER_IN` / `_OUT`~~ were mapped on 2026-10-06.
  - `REVERSE_SPLIT` is not mapped, so quantities after one are wrong.
  - A `TAX` withholding row only attaches to a dividend on the same security *and* the same settlement
    date. The sandbox puts them on different dates, so the withholding was dropped.
  - `SPLIT` is skipped when no position is known, because the ratio comes from the unit delta and needs
    the quantity before it. Correct, but silent; it should ask for an opening balance.
  - `SPINOFF` and `STOCK_MERGER` are skipped by design: the user enters those as corporate actions.
- Google OAuth client: still unconfigured, so "Continue with Google" is disabled. Not needed for
  SnapTrade sign-in or the demo.
- A "Disconnect SnapTrade" action should revoke the refresh token at SnapTrade before unlinking (Better Auth's unlink alone does not revoke).
- Re-check SnapTrade OAuth pricing before launch: the free preview is expected to last a few months.
- Verify the 2019-2026 dividend rates against CRA.
- Raise engine coverage to 100%.
- `package.json` pins `@types/node@^20` while vitest 5 wants `^22 || >=24`. pnpm tolerates the
  mismatch; npm refuses to resolve it without `--legacy-peer-deps`. Worth aligning.
- Per-transaction overrides (dividend class, return of capital), since SnapTrade cannot tell them apart.
- Check the security page, the Hub's new cards, and the Tax Center in a real browser. On 2026-10-06 the demo was checked over HTTP only: every page returns 200, and the Hub, alerts, investments, reconciliation, security page, and all three Tax Center years render the seeded data. The Tax Center CSV was downloaded and read end to end. Nothing has been opened in an actual browser, so layout, dark and light, and the 390px width are still unverified.
- Flag positions whose holdings exceed the known history even without a sale, and prompt for an opening balance.
- Re-check the Hub at 390px width in a real phone-sized viewport (the automated browser could not narrow below desktop width).
