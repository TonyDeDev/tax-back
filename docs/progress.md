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
- First migration generated in `drizzle/0000_init.sql`; not yet applied to Neon.
- Row-to-engine mappers (`ledger.ts`) and a transactional derived-table writer (`derived.ts`).
- PGlite tests apply the real migration and cover constraints, a full ledger round trip through `computeTax`, index use, and delete-my-data cascades.

### Docs

- `docs/dev.md`: developer quick start.
- `docs/tax-rules.md`: rules implemented and known limits.
- `docs/schema.md`: tables, design decisions, query-to-index map, and what the schema supports.

## Not started

- Phase 1 remainder: data table, alert banner, and a styleguide route.
- Phase 3 remainder: page read queries, and applying the migration to a Neon project.
- Phase 4: auth.
- Phase 5: demo seed and recompute pipeline.
- Phases 6 and 7: Hub, Tax Center, Settings, landing page.
- Phase 8: SnapTrade integration.
- Phases 9 and 10: quality pass and deploy.

## Open items

- Verify the 2019-2026 dividend rates against CRA.
- Raise engine coverage to 100%.
- Add the SnapTrade keys to `.env.local` by hand.
- `package.json` pins `@types/node@^20` while vitest 5 wants `^22 || >=24`. pnpm tolerates the
  mismatch; npm refuses to resolve it without `--legacy-peer-deps`. Worth aligning.
- Surface `superficial_loss_pending` in the Hub alerts so an open 30-day window is visible while the
  user can still act on it.
