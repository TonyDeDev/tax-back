# TaxBack

TaxBack is a free, working-concept web app that pulls a user's brokerage accounts through SnapTrade into one Hub and shows Canadian tax insight (ACB, capital gains, superficial losses, tax-loss harvesting, dividends).
It is a demo tool, not a commercial product and not tax advice.

## Ground Rules

- **$0 to build and run:** only free tiers that need no credit card.
  Ask before adding any service.
- **Demo first:** a visitor can click "Try the demo" and explore a realistic seeded portfolio without connecting a brokerage.
- **Tax math must be correct:** wrong numbers are worse than no demo.
- **Canada only** (CRA rules).
- **Web app first:** a responsive web app that works on desktop and phone browsers.
  Do not build a native mobile app (Expo, React Native, Flutter) or mobile-only features.

## Stack

| Layer | Choice |
| --- | --- |
| App (frontend + backend) | Next.js (App Router), TypeScript strict |
| Hosting | Vercel Hobby (free) |
| Database | Neon Postgres (free) + Drizzle ORM |
| Auth | Better Auth: Google sign-in, Sign in with SnapTrade (OpenID Connect), and one-click demo login |
| Brokerage data | SnapTrade OAuth app (free preview; the Test app allows 5 users) |
| FX rates | Bank of Canada Valet API (free) |
| UI | Tailwind CSS v4, shadcn/ui, Lucide, Recharts, TanStack Table, next-themes |
| Validation / money | zod, decimal.js |
| Tests | Vitest |

No Redis, queues, workers, Docker, or paid services.

## Project Layout

```
src/
  app/                 routes (pages, server actions, route handlers)
  server/              server-only: db, snaptrade, sync, recompute, auth
  tax-engine/          pure Canadian tax logic + tests
  components/          UI
  lib/                 formatting and client-safe helpers
scripts/seed-demo.ts   demo data generator
```

## SnapTrade

TaxBack is a SnapTrade OAuth app (https://docs.snaptrade.com/docs/oauth-apps), not a Commercial integration.
Users have a free SnapTrade Personal account, connect their brokerages there, and grant TaxBack access.

- **Two ways in:**
  - "Continue with Google" for people who want to look around first; they connect SnapTrade later from Settings ("Connect with SnapTrade", Better Auth `linkSocial`).
  - "Continue with SnapTrade" for people who already use it; sign-in and brokerage access are one consent.
- **SnapTrade is OIDC:** authorization code flow with PKCE, nonce, and id_token verification against the JWKS (Better Auth `genericOAuth`, `src/server/auth/snaptrade-provider.ts`).
  Scopes are `openid email profile read`; never request `trade`.
  The SnapTrade identity is keyed on the verified id_token `sub`, never on email; `email` may be declined.
- **Account linking is explicit only:** implicit linking by matching email is disabled, because it would let a SnapTrade account registered under someone else's email merge into their TaxBack account.
  A sign-in whose email already has an account gets `account_not_linked`; the user signs in the original way and connects SnapTrade in Settings.
- **Tokens:** Better Auth stores the access token (10 hours) and the rotating refresh token encrypted in `accounts`.
  The client secret and tokens never reach the browser: `/get-access-token`, `/refresh-token`, and `/account-info` are blocked over HTTP and only callable through `auth.api` on the server.
- **API calls:** `fetch` against `https://api.snaptrade.com` with `Authorization: Bearer <access token>` and no Commercial auth fields; validate every response with zod.
  `snaptrade-typescript-sdk` has no OAuth mode and is not used.
  SnapTrade code lives in `src/server/snaptrade/` and imports `server-only`.
- **Connections are managed in the SnapTrade Dashboard** (add, repair, remove); TaxBack links there and never shows a Connection Portal.
- **Data used:** accounts, balances, holdings, and account activities (paginated, max 1000 per page, always fetch all pages).
- **Sync** runs when the SnapTrade grant is first given (sign-in or connect), on a "Refresh" button (once per 15 min), and once daily via Vercel Cron (`/api/cron/sync`, protected by `CRON_SECRET`).
  A sync fetches everything, upserts by SnapTrade id (safe to repeat), then recomputes the user's tax data.
  A `401` means refresh once and retry once; if that fails, the user must sign in with SnapTrade again.
- **Limits:** the Test OAuth app allows 5 users and is free; Production needs SnapTrade KYC approval.
  OAuth access is a free preview and SnapTrade has said paid pricing will follow, so re-check https://docs.snaptrade.com/docs/oauth-apps before relying on it.

## Tax Engine (`src/tax-engine`)

Pure functions: ledger in, tax results out.
No I/O, no `Date.now()`, and `decimal.js` for all money, quantities, and FX (never `number`).
Rates live in a per-year config.
Every rule has Vitest tests from worked examples.

- **ACB** is pooled per security across **all** non-registered accounts at every brokerage.
  Brokers only see their own accounts, so their book value is not trusted.
  This is the core feature.
  Buys add cost + fees; sells remove `totalAcb * soldQty / totalQty`; Return of Capital lowers ACB; splits change quantity only.
- **Capital gain** = proceeds - ACB of sold - fees.
  50% inclusion rate.
  Reported in the year of the settlement date.
- **Superficial loss:** loss is denied if the same security is bought within 30 days before or after the sale (in any account, including TFSA/RRSP) and still held 30 days after.
  The denied loss is added to the new shares' ACB, or lost forever if they are in a registered account (warn clearly).
- **Registered accounts** (TFSA, RRSP, FHSA, RESP, RRIF, LIRA, and U.S. retirement accounts such as IRAs and 401(k)s) are excluded from gains and income, but included in superficial loss checks.
- **Identical property across listings:** RY on the TSX and RY on the NYSE are one pool, joined by share-class FIGI or a user link (`src/server/db/pools.ts`). Dividend class follows the issuer, not the listing.
  Users confirm each account's type.
- **Foreign currency:** convert to CAD at the Bank of Canada rate for the trade date (previous business day if none).
- **Missing history:** if a position's history is incomplete, ask the user for an opening quantity and ACB.
- **Dividends:** split into eligible, non-eligible, and foreign.
- **Transfers in kind:** paired across accounts. Non-registered to non-registered is no event; into a registered account is a deemed sale at fair market value with any loss denied for good; out of one is an acquisition at fair market value.
- **Corporate actions:** stock dividends from SnapTrade; spinoffs (ACB split by fair market value) and mergers (rollover, cash part is a disposition) entered by the user.
- **Audit trail:** every ACB event records the rule applied and the FX rate used.
- **Reconciliation:** the replayed ledger is compared with broker positions (pooled non-registered per security, each registered account on its own).
- **Sale preview:** "what if I sell?" runs the same engine with one hypothetical sale today.

`docs/tax-rules.md` lists every rule and its known limits.

The browser never calculates tax; it only displays saved results.

## Data Model

`users` and `accounts` (Better Auth; `accounts` holds the Google and SnapTrade grants, tokens encrypted), `connections`, `brokerage_accounts`, `securities`, `transactions`, `holdings`, `manual_adjustments`, `corporate_actions`, `security_preferences`, `fx_rates`, the value history `account_value_snapshots` and `security_price_snapshots` (written by each sync, never recomputed), and the derived tables `acb_positions`, `acb_events`, `realized_gains`, `superficial_losses`, `income_events`, `harvest_opportunities`, `position_reconciliations`.

## Demo Data

`src/server/demo/seed.ts` (run by `pnpm db:seed`) creates a demo user with 3 brokerages, non-registered + TFSA + RRSP + Roth IRA accounts, CAD and USD stocks, the same stock at two brokerages (pooled ACB), a TSX/NYSE interlisted stock, a superficial loss caused by a TFSA buy, a deemed sale into the TFSA, dividends, a harvesting opportunity, and one reconciliation gap, across 3 tax years.
Dates are relative to today, and exchange rates are real Bank of Canada rates (never invented: `fx_rates` is shared).
The daily cron resets it, and the Hub seeds it on the first demo visit if it is missing.

## Pages

- **Landing** (`/`): one-screen pitch, "Try the demo", "Sign in".
- **Hub** (`/hub`): total value, YTD gains, estimated tax, alerts, accounts grouped by brokerage, investments table (pooled by default, per-account toggle), allocation charts.
  Ledger vs broker reconciliation ("ledger matches broker positions: N%").
  Detail pages for each account and each security (ACB audit trail, "what if I sell?", opening balance, corporate actions).
- **Tax Center** (`/tax/[year]`): realized gains (Schedule 3 layout), superficial losses, dividends, harvesting suggestions with the 30-day window, CSV export.
- **Settings:** theme, connected brokerages (link to the SnapTrade Dashboard), delete my data (revokes the SnapTrade refresh token first).

Every page shows a "Concept demo - not tax advice" badge.

## Design

`DESIGN.md` is the visual language: near-black console look, 1px hairline borders, one green accent, Red Hat type.
`theme.css` holds every token (Tailwind v4 `@theme`) and wins on any conflict; `src/app/globals.css` imports it after `tailwindcss`.

- **Theme:** follows the system theme with a manual toggle (next-themes, `.dark` class).
  Dark is the DESIGN.md palette; light is the white + blue variant defined in `theme.css`.
- **Tokens:** components use semantic classes only (`bg-background`, `bg-card`, `border-border`, `text-foreground`, `text-muted-foreground`, `bg-primary`, `text-link`, `text-positive`, `text-negative`).
  Never use raw palette classes like `bg-carbon` or hex values in components.
  Semantic names follow shadcn/ui, so its components pick up the theme automatically.
- **Color rules:** `primary` (green in dark) fills the one main CTA per screen.
  `link` blue is for inline links only, never buttons.
  No pure white text.
- **Typography:** Red Hat Display for headings, Red Hat Text for body and UI (default `font-sans`), Red Hat Mono for codes and identifiers (`font-display`, `font-sans`, `font-mono`).
  Load all three with `next/font/google` as CSS variables `--font-red-hat-display`, `--font-red-hat-text`, `--font-red-hat-mono`.
  Use the scale `text-caption`, `text-body-sm`, `text-body`, `text-subheading`, `text-heading-sm`, `text-heading`, `text-heading-lg`, `text-display`; each class sets size, line height, and letter spacing.
  Body sizes track +0.025em and 36px+ tracks -0.025em; never flatten both to normal.
  App screens use `text-heading` and smaller; `text-heading-lg` and `text-display` are for the landing page.
- **Numbers:** `tabular-nums` on all numbers; if Red Hat Text lacks tabular figures, use Red Hat Mono for numeric columns.
  Gains and losses show a `+`/`-` sign and arrow, not just color.
  Format money with `Intl.NumberFormat('en-CA', { style: 'currency', currency })`.
- **Shape:** radius 2px (`rounded-sm`: tags, nav, icons) or 6px (`rounded-md`: buttons, cards, inputs), never larger.
  No drop shadows; elevation comes from surface steps, hairline borders, and `shadow-subtle`.
- **Spacing:** Tailwind's default 4px grid.
- **Layout (provisional, still being designed):** current direction is a desktop sidebar with bottom nav and stacked cards on phones.
  Whatever the layout, it works on phone and desktop with no horizontal page scroll.

## Commands

```
pnpm dev          start the app
pnpm db:migrate   apply Drizzle migrations
pnpm db:seed      create or reset the demo user
pnpm lint
pnpm typecheck
pnpm test
```

Environment variables (see `.env.example` and `docs/setup.md`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SNAPTRADE_OAUTH_CLIENT_ID`, `SNAPTRADE_OAUTH_CLIENT_SECRET`, `CRON_SECRET`.

Deploy by pushing to GitHub; Vercel builds automatically.

## Maybe Later

- CSV import from brokerage exports (try TaxBack without a SnapTrade slot).
- PDF tax report.
- TFSA / RRSP / FHSA contribution room tracking.
