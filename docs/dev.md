# Developer Quick Start

Read `CLAUDE.md` first.
It is the source of truth for scope, stack, and rules.

## Setup

1. Install Node 22+ and pnpm.
2. Run `pnpm install`.
3. Copy `.env.example` to `.env.local` and fill in the values (see `docs/setup.md`).
4. Never commit `.env.local` and never paste secrets into chat or issues.

## SnapTrade OAuth app

1. Create the Test OAuth app in the SnapTrade Dashboard (free, 5 users), following `docs/setup.md`.
2. Put its client id and secret in `.env.local` as `SNAPTRADE_OAUTH_CLIENT_ID` and `SNAPTRADE_OAUTH_CLIENT_SECRET`.
3. Only server code may read them or the stored tokens, and SnapTrade code imports `server-only`.

## Commands

- `pnpm dev` starts the app.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` must all pass before a PR.
- `pnpm db:migrate` and `pnpm db:seed` set up the database and demo user.

## Rules that bite

- Tax math lives only in `src/tax-engine`, uses `decimal.js`, and needs a worked-example test.
- The browser never calculates tax.
- Use semantic Tailwind tokens only, never raw colors.
- Ask before adding any paid service or new dependency outside the stack.
