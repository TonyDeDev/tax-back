# Snap Tax Back

Snap your tax back.

Snap Tax Back is a free, working-concept web app that pulls your brokerage accounts into one Hub and shows Canadian tax insight: adjusted cost base (ACB), capital gains, superficial losses, tax-loss harvesting and dividends.

> **Concept demo - not tax advice.** Snap Tax Back is a demo tool, not a commercial product.

## Why it exists

Canadian investors often hold the same stock at more than one brokerage. CRA rules pool the ACB of a security across all non-registered accounts, but each brokerage only sees its own, so the book value on a statement can be wrong. Snap Tax Back combines every account through [SnapTrade](https://snaptrade.com), pools ACB across brokerages, and flags superficial losses, including ones caused by a buy in a TFSA or RRSP.

## What you can do

- **Try the demo:** explore a realistic seeded portfolio with no brokerage connection.
- **Hub:** total value, YTD gains, estimated tax, alerts, accounts grouped by brokerage, an investments table (pooled or per account) and allocation charts.
- **Tax Center:** realized gains in a Schedule 3 layout, Schedule 7 and Schedule 15 lines, superficial losses, dividends (eligible, non-eligible, foreign), harvesting suggestions with the 30-day window, and CSV export.
- **Contributions:** TFSA, RRSP, and FHSA room and contributions, CRA figures to enter, and deposits and withdrawals to reclassify.
- **Settings:** theme, connected brokerages (managed in the SnapTrade Dashboard), delete my data.

Canada only. The browser never calculates tax; it only shows results saved by the tax engine.

## Tech stack

Next.js (App Router) and TypeScript, Neon Postgres with Drizzle ORM, Better Auth, SnapTrade, Bank of Canada Valet API for FX, Tailwind CSS v4, shadcn/ui, Recharts, decimal.js, zod and Vitest. Everything runs on free tiers with no credit card.

## Set up

### Prerequisites

- Node.js 22 or newer
- [pnpm](https://pnpm.io)
- A free [Neon](https://neon.tech) Postgres database
- Optional: a Google OAuth app for sign-in, and a free SnapTrade [OAuth app](https://docs.snaptrade.com/docs/oauth-apps) to connect real brokerages. Without these you can still use the demo login. See [docs/setup.md](docs/setup.md) for both.

### Steps

1. Clone the repo and install dependencies:

   ```bash
   git clone https://github.com/TonyDeDev/tax-back.git
   cd tax-back
   pnpm install
   ```

2. Copy the environment template and fill it in:

   ```bash
   cp .env.example .env.local
   ```

   | Variable | What it is |
   | --- | --- |
   | `DATABASE_URL` | Neon Postgres connection string |
   | `BETTER_AUTH_SECRET` | At least 32 characters (`openssl rand -base64 32`); signs sessions and encrypts the stored SnapTrade tokens |
   | `BETTER_AUTH_URL` | The app's public origin (`http://localhost:3000` locally) |
   | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth app (optional) |
   | `SNAPTRADE_OAUTH_CLIENT_ID`, `SNAPTRADE_OAUTH_CLIENT_SECRET` | SnapTrade OAuth app (optional, server only, never sent to the browser) |
   | `CRON_SECRET` | At least 32 characters; protects `/api/cron/sync` |
   | `DEMO_USER_EMAIL` | Email of the demo account (default `demo@taxback.invalid`) |

3. Create the database tables and the demo user:

   ```bash
   pnpm db:migrate
   pnpm db:seed
   ```

4. Start the app and open <http://localhost:3000>:

   ```bash
   pnpm dev
   ```

   Click **Try the demo** to explore.

### Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the app |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm db:seed` | Create or reset the demo user |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Type-check the project |
| `pnpm test` | Run Vitest |

### Deploy

Push to GitHub and import the repo into [Vercel](https://vercel.com) (Hobby plan). Add the same environment variables in the project settings. A daily Vercel Cron job calls `/api/cron/sync` to refresh connected accounts and reset the demo.

## Project layout

```
src/
  app/          routes (pages, server actions, route handlers)
  server/       server-only code: db, snaptrade, sync, recompute, auth
  tax-engine/   pure Canadian tax logic and tests
  components/   UI
  lib/          formatting and client-safe helpers
```

See [docs/tax-rules.md](docs/tax-rules.md) for every tax rule and its known limits, [docs/schema.md](docs/schema.md) for the data model, and `DESIGN.md` / `theme.css` for the visual language.

## The team

- [Tony Pham](https://www.linkedin.com/in/tonypham06?utm_source=share_via&utm_content=profile&utm_medium=member_ios)
- [Michael Toner](https://www.linkedin.com/in/michael-toner-data-driven-process-improvement?utm_source=share_via&utm_content=profile&utm_medium=member_ios)
- [Phuntsho Wangyal](https://www.linkedin.com/in/phuntsho-wangyal?utm_source=share_via&utm_content=profile&utm_medium=member_ios)


## Disclaimer

Snap Tax Back is an educational concept demo. Its numbers are not tax, legal or financial advice. Check anything you rely on with a qualified professional or the CRA.
