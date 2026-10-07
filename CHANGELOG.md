# Changelog

Notable changes to TaxBack, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
TaxBack has no releases yet, so entries are grouped by date.

## Unreleased

### Added

- **Complete tax-event engine.**
  - Stock dividends add units and add their reported value to ACB as a taxable dividend; with no value they act like a split.
  - Transfers in kind are paired across accounts:
    - Between two non-registered accounts they are not a tax event.
    - Into a TFSA, RRSP, or other registered account they are a deemed sale at fair market value, and a loss is denied for good (ITA 40(2)(g)(iv)).
    - Out of a registered account the units are acquired at fair market value.
  - Spinoffs split ACB between the parent and the spun-off shares by fair market value.
  - Mergers roll ACB over to the new shares; any cash in the deal is a disposition of its share of the ACB.
  - Spinoffs and mergers are entered by the user on the security page, because SnapTrade does not report them in a usable form.
- **ACB audit trail.**
  - Every ACB step records the rule applied and the Bank of Canada rate used.
  - The security page lists every step. Each one opens to show its source account, units x price, commission, exchange rate, the rule in plain English, and the totals after it.
  - ACB figures on the Hub link straight to the audit trail.
- **Reconciliation against the broker.**
  - The replayed ledger is compared with what each broker holds today: the pooled non-registered position per security, and each registered account on its own.
  - The Hub shows "Ledger matches broker positions: N%" and lists each gap.
  - A gap caused by missing history links to an opening balance form, prefilled with the missing units and the first activity date.
- **"What if I sell?" preview.**
  - Runs the same engine with one hypothetical sale today, settling T+1.
  - Shows the realized gain, the estimated tax at the user's marginal rate, any purchase in the last 30 days (TFSA and RRSP included) that would make a loss superficial, and the date before which not to rebuy.
  - Available in the read-only demo, since it saves nothing.
- **Security page:** position, audit trail, ledger vs broker, sale preview, realized gains, opening balance, and corporate actions.
- **Hub:** investments table, and the ledger vs broker card.
- **SnapTrade:** `STOCK_DIVIDEND` activities are mapped instead of skipped.
- **Database:** migration `0004_audit_reconcile_corporate`.
  - New tables: `corporate_actions` and `position_reconciliations`.
  - `acb_events` gains `rule`, `fx_rate`, and `corporate_action_id`.
  - `realized_gains` gains `corporate_action_id` and two new kinds: `deemed_disposition` and `merger_cash`.
  - New warning types: `transfer_unmatched`, `transfer_value_missing`, and `registered_transfer_loss_denied`.
- **Tests:** 194 to 272.
  - Golden cases for every new event type and for the sale preview.
  - 500 seeded random ledgers checking that:
    - shares are conserved in every account;
    - every ACB step chains into the next and ACB never goes negative;
    - corporate actions move ACB without creating or destroying any;
    - gains and year totals add up.
  - A PGlite test of the recompute and the new read queries, including RY bought on the TSX and sold on the NYSE with a Roth IRA repurchase.
  - Tax engine line coverage is 98.5%.

- **U.S. brokerages, for Canadian residents.**
  - Interlisted shares (RY on the TSX and the NYSE) are one ACB pool and one superficial loss check, joined by SnapTrade's share-class FIGI or linked by hand on the security page. A listing can also be kept separate.
  - New "U.S. retirement (IRA, 401(k))" account type, guessed from the broker. It is left out of gains and income like a TFSA or RRSP, and a repurchase in it makes a loss superficial and lost for good.
  - Dividends follow the issuer: RY's dividends at a U.S. broker are eligible, not foreign. The class can be set per security.
  - The sale preview can price a pooled security in any of its listings' currencies.
  - Migration `0005_interlisted_us_retirement`: `securities.figi_share_class` and `security_preferences`.

- **Demo portfolio** for "Try the demo": three brokerages, seven accounts, three tax years, dated relative to today so its superficial loss window and harvesting suggestion stay live. Run with `pnpm db:seed`; the daily cron resets it, and the Hub seeds it on the first demo visit. The Hub now shows the demo's data, read-only.

- **Tax Center** (`/tax/[year]`), on the saved results rather than placeholders.
  - Year tabs come from the years that actually have results, and `/tax` lands on the newest.
  - Summary tiles: net capital gain, taxable capital gain, dividends and income, estimated tax.
  - **Realized gains** in the Schedule 3 order (settled, security, units, proceeds, ACB, outlays, gain, reportable) with a totals row that matches the saved year summary. Each ACB links to the audit trail behind it, a denied amount is shown under the reportable figure, and a sale with incomplete history says so.
  - **Superficial losses:** the loss, how much was denied over how many units, what is allowed this year, the 30-day window, and every replacement purchase with the account it was in and whether the denied amount went onto its ACB or was lost for good. A loss whose window is still open is marked pending.
  - **Dividends** by security and class, with the number of payments, the taxable amount after the gross-up, the federal credit, and foreign tax withheld, over the per-class totals.
  - **Tax-loss harvesting** for the year in progress: unrealized loss, gains it could offset, estimated saving, whether a purchase in the last 30 days blocks the sale, the earliest safe sale date, and the date before which not to rebuy in any account.
  - A year whose rates are not verified against CRA yet says so at the top.
- **CSV export** (`/tax/[year]/export`): one file per year with a section per table, money as plain two-decimal numbers a spreadsheet can add up, and a UTF-8 BOM so Excel on Windows reads accented names correctly. Totals come from the saved year summary, so the file never recomputes tax. Available in the read-only demo.
  - Every total is calculated at full precision and rounded once, so adding up a printed column can land a cent or two away from it; the header says so. Rounding each cell first would make one column foot and then disagree with the summary, which adds the same payments up by class, so no summation order avoids it.
  - Tests: 272 to 293. The read queries run over the seeded demo on PGlite, checking for all three years that the rows the page prints add up to the saved year summary, that registered and U.S. retirement accounts stay out of gains and income, and that the SHOP superficial loss carries its TFSA replacement. Plus the CSV writer on its own: quoting, rounding, and the sections of a quiet year.

### Fixed

- **Two activity types SnapTrade reports were dropped without a trace, and both changed the tax numbers.**
  - `RETURN_OF_CAPITAL` now maps to the engine's `roc`, which lowers ACB. Dropping it left ACB too high, so gains came out too low. A reversal (a negative amount) is still skipped, because the engine refuses a negative return of capital.
  - `INTERNAL_ASSET_TRANSFER_IN` and `_OUT`, shares moved between the user's own accounts at one broker, now map to `transfer_in` and `transfer_out`. Dropping them lost the deemed disposition when the destination was a TFSA or an RRSP. Direction comes from the type name, not the sign of the units.
  - Both now reach the engine, so an activity it cannot apply raises a warning the user can act on (`roc_without_position`, `transfer_unmatched`) instead of vanishing into the skipped count.
- **A sync against a real SnapTrade connection failed on the first non-trade activity.** SnapTrade sets `settlement_date` only on trades; a dividend, fee, split, or transfer returns it as `null`, and the activity schema required a string, so `mapActivities` threw before it could decide whether the activity even mattered. Against the SnapTrade Sandbox, 24 of 26 activity types failed to parse; the reported one was whichever came first (`TRANSFER`). The settlement date is now optional and falls back to the trade date, which is the same day for every event that has no settlement. An activity with neither date is still refused. A skipped activity is now dated by its trade date too, so it still bounds how far back the history reaches.
- The shape error now names the fields that failed, instead of only the activity id and type. Diagnosing the previous message took a `snaptrade:probe` run.

### Changed

- The "Tax Center" nav item points at `/tax`, which redirects to the newest year with results, instead of a hardcoded 2026.
- Transfers no longer raise the blanket `unsupported_transfer` warning; they are handled by the rules above.
- Saving an opening balance or a corporate action recomputes in the same database transaction. A change the engine cannot compute is rolled back rather than leaving the tax results stuck.
- `computeTax` moved to `src/tax-engine/compute.ts`; `index.ts` re-exports it.

### Upgrade notes

- Run `pnpm db:migrate` for `0004` and `0005`. Migration `0004` clears `acb_events`, a derived cache, so that `rule` can be required. The next sync, Refresh, or daily cron rebuilds it.

## 2026-10-06

### Added

- SnapTrade sync: Bearer-token client with zod-validated responses and full activity paging. On a 401 it refreshes once, then asks the user to reconnect.
- Bank of Canada exchange rates from the Valet API, fetching only the missing range.
- Recompute from the stored ledger into the derived tables, for one user.
- Sync triggers: the first grant, the Refresh button (once per 15 minutes), and a daily cron that also deletes expired sessions.
- Hub with real data: total value in CAD, YTD realized gains, estimated tax, alerts, and accounts grouped by brokerage with an account type picker.

### Fixed

- Cash accounts (Wealthsimple Cash, chequing) are synced for their balance; only credit cards are skipped.
- Generic broker account names are replaced from SnapTrade's detailed type, so a savings account shows as "Savings".

## 2026-10-05

### Added

- Better Auth with Google sign-in, Sign in with SnapTrade (OpenID Connect), and one-click demo login.
- SnapTrade tokens stored encrypted; the endpoints that return them are blocked over HTTP.
- Database schema, migrations, and the mappers between rows and the tax engine.

### Fixed

- Tax engine correctness pass, each bug reproduced by a failing test first:
  - A denied superficial loss could be reported as lost forever even though a non-registered replacement existed.
  - A split reported by two accounts was applied twice.
  - A superficial loss inside the last 30 days was reported as settled; it is now `pending` until the window closes.
  - Standalone `fee` entries are now handled explicitly.

### Security

- Demo sessions store no IP or user agent, and may only call an allowlist of auth endpoints.
- The demo email uses the reserved `.invalid` domain, so no OAuth provider can verify it and claim the account.
- Derived tables reference transactions and accounts through `(id, user_id)` composite keys.
- Strict server-only env validation, a nonce-based CSP, and security headers.

## 2026-10-04

### Added

- Tax engine:
  - pooled ACB across all non-registered accounts;
  - capital gains at a 50% inclusion rate, reported in the settlement-date year;
  - superficial losses, including TFSA and RRSP repurchases;
  - dividends split into eligible, non-eligible, and foreign;
  - tax-loss harvesting suggestions.
- App shell, light and dark themes, shared components, and placeholder pages.
- Next.js scaffold with TypeScript strict, Tailwind v4, ESLint, Vitest, and CI.

## 2026-10-01

### Added

- Project guides (`CLAUDE.md`, `AGENTS.md`) and the `DESIGN.md` visual language.
