# TaxBack - Agent Guide

This file is the source of truth for any agent working on TaxBack.
Read it fully before making changes.
When a decision here conflicts with a convenient shortcut, follow this file.
If this file is wrong or outdated, update it in the same change that makes it wrong.

---

## 1. Product Overview

TaxBack is a cross-platform mobile app (iOS, Android, and later web) that connects a user's brokerage and investment accounts through the SnapTrade API.
It turns raw holdings and transaction history into Canadian tax insight.
The goal is to help users keep more of their money by surfacing tax-relevant facts they would otherwise miss.

### Target user

- Canadian self-directed investors with one or more brokerages (Wealthsimple, Questrade, TD, RBC DI, IBKR, etc.).
- Users who hold a mix of non-registered (taxable) accounts and registered accounts (TFSA, RRSP, FHSA, RESP, RRIF, LIRA).
- Users who currently track ACB in spreadsheets, or do not track it at all.

### Core value

- One view of every investment account the user owns, across brokerages.
- Accurate Adjusted Cost Base (ACB) per security, pooled across all non-registered accounts, as CRA requires.
- Realized capital gains and losses per tax year, ready to transcribe into Schedule 3.
- Superficial loss detection, including cross-account and registered-account repurchases.
- Tax-loss harvesting opportunities with a clear 30-day repurchase window.
- Dividend and income summaries per tax year.
- Exportable tax reports (PDF and CSV) for the user or their accountant.

### Non-goals

- TaxBack does not file tax returns.
- TaxBack does not place trades, even though SnapTrade supports trading.
- TaxBack is not tax advice.
  Every tax screen links to a disclaimer, and onboarding requires the user to acknowledge it.
- Jurisdiction is **Canada only** (CRA rules).
  The tax engine is designed so other jurisdictions could be added later, but no US logic should be written now.

---

## 2. SnapTrade Integration

SnapTrade is a brokerage aggregation API.
It is the only source of live account data in the first release.
Docs: https://docs.snaptrade.com

### Integration model

- TaxBack is a **Commercial** SnapTrade integration.
- The backend registers each TaxBack user with SnapTrade (`registerUser`) and receives a `userId` and `userSecret`.
- `userSecret` is returned **only once** at registration.
  Store it immediately, encrypted at rest with KMS envelope encryption, in the `snaptrade_users` table.
  Losing it means the user must be deleted and re-registered with SnapTrade.
- The SnapTrade `clientId` and `consumerKey` live **only** on the backend, loaded from the secret manager.
- The mobile app **never** calls SnapTrade directly and never sees `consumerKey` or `userSecret`.
- Use the official SDK: `snaptrade-typescript-sdk`.
  Wrap it in a single `SnapTradeClient` service in `apps/api/src/integrations/snaptrade/` so the rest of the code never imports the SDK directly.

### Connecting a brokerage

1. The app calls `POST /v1/connections/portal` on the TaxBack API.
2. The API calls SnapTrade "Generate Connection Portal URL" (login link) for that user, with `customRedirect` set to `taxback://connect/callback`.
3. The app opens the URL with `expo-web-browser` `openAuthSessionAsync`.
4. On redirect back, the app shows an "initial sync" screen and polls `GET /v1/sync/status` until the first transaction sync completes.
5. The backend learns about the new connection from the `CONNECTION_ADDED` and `NEW_ACCOUNT_AVAILABLE` webhooks, not from the redirect.

### Broken connections

- Brokerage tokens expire or get revoked, and SnapTrade marks the connection disabled (`CONNECTION_BROKEN`).
- Supporting reconnect is **required** by SnapTrade.
- To fix a connection, generate a portal URL with the connection id in the `reconnect` field.
- The Accounts tab must show connection health and a "Reconnect" action for every broken connection.
- Send a push notification when a connection breaks, at most once per connection per 3 days.

### Data we use

| SnapTrade data | Used for |
| --- | --- |
| Accounts list | Account names, numbers (masked), institution, account type tagging |
| Balances | Cash per currency, net worth |
| Holdings / positions | Current quantity, market value, broker average purchase price |
| Tax lots (`tax_lots` on holdings) | Optional cross-check only. Disabled by default and only on paid plans. |
| Account activities (`/accounts/{accountId}/activities`) | The transaction ledger: BUY, SELL, DIVIDEND, interest, fees, contributions, withdrawals, transfers, splits, etc. |

- Account activities are paginated with a maximum of 1000 records per page.
  Always paginate to completion and never assume one page is everything.
- Broker-reported average cost and tax lots are **never** the source of truth for ACB.
  See section 3 for why.

### Data freshness

- On the Daily plan, holdings sync once per day.
- Transactions are cached, updated once per day, and delayed by one day.
  Intraday transactions are not available.
- The refresh connection endpoint can force an intraday holdings refresh but may incur extra charges.
  User-triggered refresh is rate-limited to once per connection per hour, enforced on the backend.
- Use each account's `sync_status` to show "Data as of <date>" in the UI.
  Never present stale data as current.

### Webhooks

Endpoint: `POST /v1/webhooks/snaptrade`.

| Event | Action |
| --- | --- |
| `CONNECTION_ADDED` | Upsert connection, enqueue account discovery |
| `CONNECTION_BROKEN` | Mark connection broken, notify user |
| `CONNECTION_FIXED` | Mark connection healthy, enqueue sync |
| `CONNECTION_DELETED` | Soft-delete connection and its accounts |
| `NEW_ACCOUNT_AVAILABLE` | Upsert account, ask user to confirm account type |
| `ACCOUNT_TRANSACTIONS_INITIAL_UPDATE` | Enqueue full history sync for the account |
| `ACCOUNT_TRANSACTIONS_UPDATED` | Enqueue incremental transaction sync |
| `ACCOUNT_HOLDINGS_UPDATED` | Enqueue holdings and balances sync |
| `ACCOUNT_REMOVED` | Soft-delete account |
| `USER_DELETED` | Confirm local deletion completed |

Rules:

- Verify every webhook.
  The `Signature` header is a base64-encoded HMAC-SHA256 of the JSON body (serialized with sorted keys), keyed with the consumer key.
  Compare with a constant-time comparison and reject on mismatch with `401`.
- Respond `200` fast and do all work in a queued job.
- Handlers must be idempotent.
  Store the webhook id in `webhook_events` and skip duplicates.
- Webhooks are a trigger, not a data source.
  Always re-fetch data from SnapTrade inside the job.
- A nightly reconciliation job polls connections and sync status in case a webhook was missed.

---

## 3. Canadian Tax Domain

This is the heart of the product.
Correctness matters more than anything else in this codebase.
All rules live in `packages/tax-engine`.

### Engine rules

- The engine is **pure and deterministic**: input is a ledger plus configuration, output is derived tax data.
  No I/O, no clock reads, no randomness.
- All money and quantity math uses `decimal.js`.
  JavaScript `number` is forbidden for money, quantity, or FX rates.
  A lint rule enforces this inside `packages/tax-engine`.
- Rates and thresholds are data keyed by tax year (`taxYearConfig[2026]`), never inline constants.
- Every rule has fixture tests built from worked examples (CRA guides, IT folios, and hand-checked spreadsheets).
- Every derived number must be explainable.
  The engine emits an explanation trail (which transactions and adjustments produced this ACB or gain) that the app can render.

### Adjusted Cost Base (ACB)

- ACB is calculated per **identical property** per taxpayer.
- It is **pooled across all of the user's non-registered accounts at every brokerage**.
  A brokerage only sees its own accounts, so its reported book value is often wrong for users with more than one brokerage.
  This is the main reason TaxBack exists.
- Buys add cost plus commissions and fees to the pool.
- Sells reduce the pool proportionally: `acbOfSold = totalAcb * (soldQty / totalQty)`.
- Return of Capital reduces ACB.
  If ACB goes negative, the negative amount is a deemed capital gain and ACB resets to zero.
- Reinvested capital gains distributions (phantom distributions) increase ACB.
- Stock splits and consolidations change quantity but not total ACB.
- Mergers, spin-offs, and other corporate actions require per-event rules.
  Until a rule exists, flag the security as "needs review" rather than guessing.

### Capital gains

- `gain = proceeds - acbOfSold - outlaysAndExpenses`.
- Inclusion rate is 50%, stored per tax year in config.
  The proposed increase to two-thirds was cancelled, so no tiered inclusion logic should exist.
- Gains are reported in the tax year of the **settlement date**, not the trade date.
  Store both dates on every transaction.
- Net capital losses carry back 3 years and forward indefinitely.
  The app tracks the carryforward balance across years.

### Superficial loss

A loss is superficial (denied) when both are true:

1. The same or identical property is acquired in the period from 30 days before to 30 days after the sale (61-day window).
2. The property is still held at the end of that window (day 30 after the sale).

Rules:

- Repurchases by the user **or an affiliated person** (spouse, controlled corporation) count.
  In v1 only the user's own accounts are scanned, and the UI says so.
- Repurchases inside **registered accounts** (TFSA, RRSP, FHSA, etc.) count.
- The denied loss is added to the ACB of the substitute property.
  If the substitute property is in a registered account, the loss is permanently lost.
  The UI must call this out loudly.
- Partial superficial losses are prorated by the repurchased quantity still held.

### Registered accounts

- TFSA, RRSP, FHSA, RESP, RRIF, LIRA, and LRSP are excluded from gain, loss, and income calculations.
- They are still included in superficial loss scanning and in the portfolio overview.
- SnapTrade's account type is not always reliable, so the user confirms the type for every account during onboarding.

### Foreign currency

- Every transaction in a foreign currency is converted to CAD using the Bank of Canada daily exchange rate for the transaction date (Bank of Canada Valet API).
- If no rate exists for that day (weekend or holiday), use the most recent prior business day rate.
- Store original amount, original currency, FX rate, and rate source on every transaction.
- FX rates are cached in the `fx_rates` table and fetched by a daily job.

### Income

- Dividends are split into eligible and non-eligible Canadian dividends and foreign dividends.
- Show gross-up and dividend tax credit amounts as informational only.
- Track foreign withholding tax for the foreign tax credit summary.
- Interest income is summarized per year.

### Reporting and reconciliation

- The year-end summary maps to Schedule 3 lines (description, year of acquisition, proceeds, ACB, outlays, gain or loss).
- Flag T1135 when the total cost of specified foreign property exceeds $100,000 CAD at any point in the year.
- Reconcile per-account proceeds against what the brokerage will report on T5008, and explain differences (T5008 often shows broker book value, not pooled ACB).

### Missing or incomplete data

- SnapTrade history may not reach back to when a position was opened.
  If the ledger starts with a sell or with a quantity mismatch versus current holdings, the engine marks the position "incomplete".
- Incomplete positions show a task in the Tax Center asking the user to enter an opening quantity and ACB as of a date.
- Return of Capital and phantom distributions usually come from T3 slips, not SnapTrade.
  Users can add these as manual adjustments.
- Every manual adjustment is stored in `manual_adjustments` with the user, timestamp, reason, and before and after values, and is shown in the explanation trail.

---

## 4. Architecture

### Overview

```
Mobile app (Expo)
   |  HTTPS, JSON, session token
   v
TaxBack API (Fastify)  <---- SnapTrade webhooks
   |            |
   |            v
   |        BullMQ queues (Redis) -> sync workers -> SnapTrade API
   |                                     |
   v                                     v
Postgres  <---- normalized ledger ---- tax-engine recompute
```

### Monorepo layout

pnpm workspaces plus Turborepo.

```
apps/
  mobile/            Expo app (expo-router, TypeScript strict)
  api/               Fastify HTTP API and webhook receiver
  worker/            BullMQ workers (sync, recompute, FX, notifications)
packages/
  tax-engine/        Pure Canadian tax logic (ACB, gains, superficial loss, harvesting)
  shared/            zod schemas and DTO types shared by app, API, and worker
  db/                Drizzle schema, migrations, and query helpers
  design-tokens/     Color, typography, spacing, radius tokens for both themes
  config/            Shared ESLint, TypeScript, and Prettier configs
```

Dependency rules:

- `tax-engine` depends on nothing in the repo except `shared` types.
- `mobile` never imports `db`, `api`, or `worker`.
- `api` and `worker` share code through `packages/*` only, never by importing each other.

### Backend stack

- Runtime: Node.js LTS, TypeScript strict.
- HTTP: Fastify with `fastify-type-provider-zod`; OpenAPI generated from zod schemas.
- Database: Postgres with Drizzle ORM and Drizzle migrations.
- Jobs: BullMQ on Redis, with retries, exponential backoff, and dead-letter queues.
- Auth: Better Auth inside the API (email one-time code, passkeys, Sign in with Apple, Sign in with Google).
- Observability: pino structured logs, OpenTelemetry traces, Sentry for errors.
- The mobile client gets a typed API client generated from the OpenAPI spec.

### Data pipeline

1. Webhook or scheduled job enqueues a sync job for an account.
2. The sync worker fetches activities (paginated) and holdings from SnapTrade.
3. Raw payloads are stored in `raw_snaptrade_activities` for audit and re-normalization.
4. A normalizer maps raw activities into the `transactions` ledger, idempotent on the SnapTrade activity id.
5. Securities are resolved to a canonical `securities` row (symbol, exchange, currency, FIGI or ISIN when available) so the same security at two brokerages pools correctly.
6. A recompute job loads the user's full ledger plus manual adjustments and FX rates, runs `tax-engine`, and writes derived tables in a single transaction.
7. The API serves derived tables.
   The app never computes tax numbers itself.

Recompute is per user and serialized (one job at a time per user) to avoid races.

### Core tables

- `users`, `sessions` (Better Auth).
- `snaptrade_users` (user id, SnapTrade user id, encrypted user secret).
- `connections` (brokerage, status, last synced, broken since).
- `accounts` (connection, masked number, currency, confirmed account type).
- `securities` (canonical security identity).
- `raw_snaptrade_activities` (raw JSON, fetched at).
- `transactions` (normalized ledger: type, trade date, settlement date, quantity, price, amount, fees, currency, FX rate, source).
- `manual_adjustments` (opening balances, ROC, phantom distributions, corrections).
- `fx_rates` (date, currency pair, rate, source).
- Derived: `acb_positions`, `realized_gains`, `superficial_losses`, `income_events`, `tax_year_summaries`, `harvest_opportunities`.
- `webhook_events`, `audit_log`, `notifications`.

### Security and privacy

- Host in Canada (AWS `ca-central-1` or an equivalent Canadian region) for data residency.
- Comply with PIPEDA and Quebec Law 25: consent at onboarding, data export, and full account deletion.
- Account deletion deletes the SnapTrade user (`deleteSnapTradeUser`) and all local data.
- Postgres encrypted at rest; `userSecret` additionally envelope-encrypted with KMS.
- Never log PII, account numbers, balances, or SnapTrade secrets.
  The logger has a redaction list; extend it when adding new sensitive fields.
- Secrets come from the secret manager in deployed environments and `.env.local` in development.
- All API routes require auth except health checks and the signature-verified webhook route.
- Rate-limit auth and refresh endpoints.

---

## 5. Mobile App

### Stack

- Expo (latest SDK) with the managed workflow and EAS Build.
- expo-router for file-based navigation.
- TanStack Query for all server state; Zustand only for small client-only UI state.
- react-native-unistyles for typed theming driven by `packages/design-tokens`.
- victory-native (Skia) for charts.
- react-native-reanimated and react-native-gesture-handler for motion.
- expo-web-browser for the SnapTrade portal, expo-secure-store for the session token, expo-local-authentication for optional biometric lock, expo-notifications for push.
- Sentry for crash and error reporting.

### Structure

```
apps/mobile/
  app/                     expo-router routes
    (auth)/                sign in, onboarding, disclaimer
    (tabs)/                home, accounts, holdings, tax, settings
    connect/callback.tsx   SnapTrade redirect target
  src/
    api/                   generated client and query hooks
    components/            shared UI primitives
    features/              feature modules (accounts, holdings, tax-center, ...)
    theme/                 unistyles setup reading design tokens
    lib/                   formatting, dates, money helpers
```

### Client rules

- Money arrives from the API as decimal strings and is formatted, never re-calculated, on the client.
- Format currency with `Intl.NumberFormat('en-CA', { style: 'currency', currency })`.
- Every data screen has loading, empty, error, and stale ("Data as of") states.
- Pull to refresh invalidates queries; it only triggers a SnapTrade refresh if the backend rate limit allows.
- Sensitive screens hide balances in the app switcher snapshot.

---

## 6. Design System

The visual language is **monochrome with a single accent**.
Surfaces are neutral, hierarchy comes from spacing, type weight, and elevation, and color is reserved for the one accent and for gain and loss signals.

### Themes

Follow the system theme by default, with a manual override (System, Dark, Light) in Settings.

**Dark - charcoal and green**

| Token | Value |
| --- | --- |
| `bg` | `#121417` |
| `surface` | `#1A1D21` |
| `surfaceElevated` | `#23272C` |
| `border` | `#2E3338` |
| `textPrimary` | `#E8EAED` |
| `textSecondary` | `#9AA0A6` |
| `accent` | `#2ECC71` |
| `accentMuted` | `#1E3A2B` |
| `onAccent` | `#0B0D0F` |
| `positive` | `#2ECC71` |
| `negative` | `#E5675C` |
| `warning` | `#E3B341` |

**Light - white and blue**

| Token | Value |
| --- | --- |
| `bg` | `#FFFFFF` |
| `surface` | `#F6F8FA` |
| `surfaceElevated` | `#FFFFFF` |
| `border` | `#E3E7EB` |
| `textPrimary` | `#0F172A` |
| `textSecondary` | `#5B6573` |
| `accent` | `#2563EB` |
| `accentMuted` | `#E6EEFD` |
| `onAccent` | `#FFFFFF` |
| `positive` | `#15803D` |
| `negative` | `#C2410C` |
| `warning` | `#B45309` |

Rules:

- Components use semantic tokens only.
  Hex values appear in `packages/design-tokens` and nowhere else.
- Gain and loss never rely on color alone.
  Always pair color with a sign (`+` or `-`) and an arrow icon.
- All text and icon pairs meet WCAG AA contrast in both themes; a token test checks this.
- In light mode, `elevated` surfaces use a subtle shadow instead of a lighter color.

### Typography, spacing, and shape

- Font: Inter, with `fontVariant: ['tabular-nums']` on every number.
- Scale: 12, 14, 16, 20, 24, 32, 40.
- Spacing: 4pt grid (4, 8, 12, 16, 24, 32, 48).
- Radius: 12 for cards and inputs, 16 for sheets, full for pills.
- Icons: one outline icon set (Lucide), 20 and 24 sizes.
- Motion: short (150 to 250 ms), purposeful, and disabled when the OS reduce-motion setting is on.

### Quality bar

- Pixel perfection is expected.
  Check every screen in both themes, on a small phone and a large phone, and with the largest accessibility font size.
- Respect safe areas, dynamic type, and screen readers (labels on every interactive element and on every number).

---

## 7. App Screens and User Workflow

### First run

1. Welcome and value proposition.
2. Sign up or sign in.
3. Disclaimer and privacy consent (must be accepted).
4. Connect first brokerage through the SnapTrade portal.
5. Confirm account types (non-registered, TFSA, RRSP, FHSA, RESP, RRIF, LIRA, other).
6. Initial sync progress, then land on Home.

### Tabs

**Home**

- Total portfolio value and change.
- Year-to-date realized gain or loss and estimated taxable capital gain.
- Tax-loss harvesting opportunity total.
- Alerts: broken connections, superficial loss warnings, incomplete positions.

**Accounts**

- Grouped by brokerage connection with health status and "Data as of".
- Account detail with balances, holdings, and activity list.
- Add brokerage, reconnect, and remove connection.

**Holdings**

- All securities pooled across accounts, with a toggle to view per account.
- Position detail: quantity, pooled ACB, ACB per share, market value, unrealized gain or loss, explanation trail, transactions.

**Tax Center**

- Tax year picker.
- Realized gains and losses (Schedule 3 view).
- Superficial losses with the triggering repurchase.
- Dividends and interest summary.
- Tax-loss harvesting suggestions with the 30-day "do not repurchase" calendar and registered-account warnings.
- Carryforward losses.
- Tasks: incomplete positions, unconfirmed account types, manual adjustments needed.
- Export report as PDF or CSV.

**Settings**

- Theme, notifications, biometric lock, connected brokerages, data export, delete account, disclaimer, and support.

---

## 8. Development Workflow

### Commands

```
pnpm install             Install all workspace dependencies
pnpm dev                 Run api, worker, and mobile together via Turborepo
pnpm --filter mobile start
pnpm --filter api dev
pnpm --filter worker dev
pnpm db:generate         Generate a Drizzle migration from schema changes
pnpm db:migrate          Apply migrations
pnpm lint                ESLint across the repo
pnpm typecheck           tsc --noEmit across the repo
pnpm test                Unit and integration tests
pnpm test:e2e            Maestro flows against a dev build
```

Local Postgres and Redis run through `docker compose up`.

### Environment

- `.env.example` lists every variable; `.env.local` holds real values and is git-ignored.
- Use SnapTrade test or sandbox credentials locally.
- Expose the local webhook route with a tunnel (for example `cloudflared`) when testing webhooks.

### Testing expectations

- `tax-engine`: Vitest with fixture-based golden tests.
  Any change to tax logic must add or update fixtures, and no change merges with a failing or skipped engine test.
- `api` and `worker`: Vitest integration tests against a real Postgres (Testcontainers), with SnapTrade mocked at the `SnapTradeClient` boundary using recorded fixtures.
- `mobile`: Jest with React Native Testing Library for components, Maestro for end-to-end flows.
- Flaky tests are bugs.
  Fix them, do not retry or skip them.

### Conventions

- TypeScript strict everywhere, no `any`, no non-null assertions without a comment explaining why.
- Validate every external input (HTTP bodies, webhooks, SnapTrade responses) with zod at the boundary.
- Dates: store `date` for trade and settlement dates, `timestamptz` for events; tax years use the `America/Toronto` calendar date.
- Conventional Commits (`feat:`, `fix:`, `chore:`, ...).
- Never add an agent name as a co-author in commits.
- Never manually edit `CHANGELOG.md` or any generated file (OpenAPI client, Drizzle snapshots).
- Never use the em dash character in code, docs, or UI copy.
- Fix lint warnings and test failures you encounter, even if unrelated to the current task.
- If another agent appears to be mid-edit (build errors in files you did not touch), wait and retry instead of editing those files.

### CI

- On every pull request: lint, typecheck, unit tests, tax-engine golden tests, migration check.
- On `main`: the above plus EAS preview builds and API deploy to staging.

---

## 9. Roadmap and Future Features

Ordered roughly by expected value.

1. **Manual and CSV import** for history before SnapTrade's range and for brokerages SnapTrade does not support.
2. **Slip upload with OCR** (T3, T5, T5008) to capture Return of Capital, phantom distributions, and reconcile income.
3. **Year-end harvesting planner** with push reminders ahead of the last trade date that settles in the calendar year.
4. **Registered account room tracking** for TFSA, RRSP, and FHSA contributions and withdrawals, with over-contribution warnings.
5. **Household view** for spouses and affiliated persons, so superficial loss scanning covers both partners.
6. **Accountant sharing**: a read-only, expiring share link and exports formatted for Canadian tax software.
7. **Corporate action library** covering common Canadian mergers, spin-offs, and ETF reorganizations.
8. **Plain-language explanations** of tax events using an LLM, grounded strictly in engine output.
9. **Crypto accounts**, treated as capital property with the same ACB and superficial loss rules.
10. **Web app** through Expo for web, sharing the same routes and components.
11. **Home-screen widgets** for portfolio value and harvesting opportunities.
12. **Other jurisdictions** (US first) through the jurisdiction-versioned engine, only once Canada is solid.

---

## 10. Open Questions

- Which SnapTrade plan to launch on (Daily vs Real-time, and whether to pay for tax lots as a cross-check).
- Monetization model (free tier plus paid tax season export, or subscription).
- Whether to support Quebec-specific reporting (TP-1 Schedule G) at launch.
