# Developer Quick Start

Read `CLAUDE.md` first.
It is the source of truth for scope, stack, and rules.

## Setup

1. Install Node 22+ and pnpm.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env.local` and fill in the values.
4. Never commit `.env.local` and never paste secrets into chat or issues.

## SnapTrade keys

1. Get a Client ID and Consumer Key from the SnapTrade dashboard (Build plan, free).
2. Put them in `.env.local` as `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY`.
3. Only code in `src/server/snaptrade/` may read them, and it must import `server-only`.

## Commands

- `pnpm dev` starts the app.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` must all pass before a PR.
- `pnpm db:migrate` and `pnpm db:seed` set up the database and demo user.

## Rules that bite

- Tax math lives only in `src/tax-engine`, uses `decimal.js`, and needs a worked-example test.
- The browser never calculates tax.
- Use semantic Tailwind tokens only, never raw colors.
- Ask before adding any paid service or new dependency outside the stack.
