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
| Auth | Better Auth: GitHub/Google sign-in + one-click demo login |
| Brokerage data | SnapTrade Build plan (free, 5 connected accounts) |
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

- The server registers each user (`registerUser`) and gets a `userId` + `userSecret`.
  `userSecret` is returned only once; store it encrypted (AES-256-GCM, `ENCRYPTION_KEY`).
- `clientId`, `consumerKey`, and `userSecret` never reach the browser.
  SnapTrade code lives in `src/server/snaptrade/` and imports `server-only`.
- Use `snaptrade-typescript-sdk`.
- **Connect:** server action creates a Connection Portal URL with `customRedirect` to `/connect/callback`, browser redirects there, callback runs a sync.
- **Reconnect:** same portal URL with the connection id in `reconnect`; show a "Reconnect" button for broken connections.
- **Data used:** accounts, balances, holdings, and account activities (paginated, max 1000 per page, always fetch all pages).
- **Sync** runs on connect, on a "Refresh" button (once per 15 min), and once daily via Vercel Cron (`/api/cron/sync`, protected by `CRON_SECRET`).
  A sync fetches everything, upserts by SnapTrade id (safe to repeat), then recomputes the user's tax data.
- Free plan allows 5 connected accounts; when full, the Connect button points users to the demo.

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
- **Registered accounts** (TFSA, RRSP, FHSA, RESP, RRIF, LIRA) are excluded from gains and income, but included in superficial loss checks.
  Users confirm each account's type.
- **Foreign currency:** convert to CAD at the Bank of Canada rate for the trade date (previous business day if none).
- **Missing history:** if a position's history is incomplete, ask the user for an opening quantity and ACB.
- **Dividends:** split into eligible, non-eligible, and foreign.

The browser never calculates tax; it only displays saved results.

## Data Model

`users` (Better Auth), `snaptrade_users`, `connections`, `brokerage_accounts`, `securities`, `transactions`, `holdings`, `manual_adjustments`, `fx_rates`, and the derived tables `acb_positions`, `realized_gains`, `superficial_losses`, `income_events`, `harvest_opportunities`.

## Demo Data

`scripts/seed-demo.ts` (`pnpm db:seed`) creates a demo user with 3 brokerages, non-registered + TFSA + RRSP accounts, CAD and USD stocks, the same stock at two brokerages (pooled ACB), a superficial loss caused by a TFSA buy, dividends, and a harvesting opportunity, across 3 tax years.
The daily cron resets it.

## Pages

- **Landing** (`/`): one-screen pitch, "Try the demo", "Sign in".
- **Hub** (`/hub`): total value, YTD gains, estimated tax, alerts, accounts grouped by brokerage, investments table (pooled by default, per-account toggle), allocation charts.
  Detail pages for each account and each security (with ACB breakdown).
- **Tax Center** (`/tax/[year]`): realized gains (Schedule 3 layout), superficial losses, dividends, harvesting suggestions with the 30-day window, CSV export.
- **Settings:** theme, connected brokerages, delete my data.

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

Environment variables (see `.env.example`): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY`, `ENCRYPTION_KEY`, `CRON_SECRET`.

Deploy by pushing to GitHub; Vercel builds automatically.

## Maybe Later

- CSV import from brokerage exports (try TaxBack without a SnapTrade slot).
- PDF tax report.
- TFSA / RRSP / FHSA contribution room tracking.
