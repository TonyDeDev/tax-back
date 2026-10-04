# Progress

Status as of 2026-10-04.
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
- 35 passing tests, about 93% line coverage.

### Docs

- `docs/dev.md`: developer quick start.
- `docs/tax-rules.md`: rules implemented and known limits.

## Not started

- Phase 1: design system and app shell.
- Phase 3: database schema and queries.
- Phase 4: auth.
- Phase 5: demo seed and recompute pipeline.
- Phases 6 and 7: Hub, Tax Center, Settings, landing page.
- Phase 8: SnapTrade integration.
- Phases 9 and 10: quality pass and deploy.

## Open items

- Verify the 2019-2026 dividend rates against CRA.
- Raise engine coverage to 100%.
- Add the SnapTrade keys to `.env.local` by hand.
