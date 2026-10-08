# Tax Rules Implemented

These are the rules in `src/tax-engine`.
Each one has worked-example tests next to the code.
This is a concept demo and not tax advice.

## ACB

- ACB is pooled per security across every non-registered account.
- Buys add cost plus fees, converted to CAD at the trade-date rate.
- Sells remove `totalAcb * soldQty / totalQty`.
- Return of capital lowers ACB, and any excess over ACB is an immediate capital gain.
- Splits change quantity only.
- A split is one corporate action even though every account holding the security reports it, so the
  ratio is applied once per event rather than once per account.
- Standalone account fees do not change ACB; they are carrying charges, not costs of a trade.
  Trade commissions arrive on the buy or sell itself.
- Reinvested dividends (DRIPs) are purchases: their cost adds to ACB.
- Stock dividends add units, and their reported value is both a taxable dividend and their cost.
  With no value reported they behave like a split.
- Every change to the pool is stored as an audit step with the rule applied and the Bank of Canada
  rate used, so any ACB figure can be traced back to the events that produced it.

## Identical Property Across Listings

- Shares of the same class are identical property wherever they trade, so RY on the TSX and RY on the
  NYSE share one ACB pool and one superficial loss check. Each trade is still converted at its own
  date's rate in its own currency.
- Listings are joined automatically when SnapTrade gives them the same share-class FIGI
  (`figi_instrument.figi_share_class`). A user can link two listings by hand, or keep a matched
  listing separate, on the security page.
- The pool is held under one canonical listing: the Canadian one, else the CAD one.

## U.S. Accounts

- U.S. brokerages connect through SnapTrade like Canadian ones. The engine still applies CRA rules: it
  is for Canadian residents, not U.S. taxpayers.
- IRAs, Roth IRAs, 401(k)s, and similar are a `us_retirement` account type. Growth inside them is not
  taxed each year in Canada, so they are left out of gains and income like a TFSA or RRSP.
- A purchase in one counts for superficial loss checks, and a loss replaced there is lost for good.
  This is the cautious reading; the CRA has not ruled on it directly.

## Transfers In Kind

- The two sides of a transfer are paired by security, quantity, a different account, and dates within 10 days.
- Between two non-registered accounts: no tax event; the pool already spans both.
- From a non-registered account into a registered one (TFSA, RRSP, ...): a deemed sale at fair market
  value. A gain is taxable; a loss is denied for good (ITA 40(2)(g)(iv)) and, unlike a superficial
  loss, is not added to anything.
- From a registered account into a non-registered one: the units are acquired at fair market value.
- A transfer across that boundary with no market value from the broker is flagged and not applied.
- A transfer with no counterpart (the other account is not connected) is flagged. Units arriving that
  way have no cost, so reconciliation asks for an opening balance.

## Corporate Actions

Brokers do not report these in a usable form, so the user records them on the security page.
They apply to the security as a whole: the pool and every registered account holding it.

- **Spinoff:** the spun-off shares receive `parent ACB x child value / (parent value + child value)`,
  using fair market values just after the spinoff. The parent keeps the rest.
- **Merger, all shares:** ACB rolls over to the new shares (section 85.1).
- **Merger with cash:** ACB is split by fair market value between the cash and the new shares; the cash
  is a disposition of its share (proceeds = cash), and the new shares carry the remainder.

## Reconciliation

- After replaying the ledger, the units it arrives at are compared with what each broker holds today:
  the pooled non-registered position per security, and each registered account on its own.
- A gap is either units with no history (an opening balance closes it) or units unaccounted for.
- Only gaps in the pooled non-registered position can change tax, since only it carries ACB.
  Each gap falls in one class (`src/server/reconciliation.ts`):
  - **Tax gap:** non-registered, and either present since the account's first reconciliation (history the broker never shared) or older than 3 days.
    The Hub lists it under "Needs attention" and the security page asks for an opening balance.
  - **Waiting:** non-registered, and it appeared on a later sync less than 3 days ago.
    Brokers count a new trade in their holdings a day or so before reporting it as an activity (a recurring buy is the usual case), so the user is not asked yet.
  - **Registered:** inside a TFSA, RRSP, or other registered account.
    There is no ACB, so it has no effect on tax and asks for nothing; it can only hide a purchase from a superficial loss check.
- `position_reconciliations.gap_since` records the day a gap appeared.
  The recompute carries it across while the gap keeps its direction, starts it today when a matching position drifts or a new position appears in an account already reconciled, and leaves it null on an account's first reconciliation.
- The Hub shows "Ledger matches broker positions" as the share of non-registered positions that agree, and notes waiting and registered gaps separately.
- A security held only in registered accounts (no ACB events, gains, opening balance, or corporate action) shows no ACB figures or opening balance form.

## Sale Preview

- "What if I sell?" adds one hypothetical sale from the pooled non-registered position today, settling
  T+1 (weekends skipped, holidays not modelled), and runs the whole engine again.
- It shows the gain, the tax at the user's marginal rate, any purchase in the last 30 days that would
  make a loss superficial (TFSA and RRSP included), and the date before which not to rebuy.

## Capital Gains

- Gain is proceeds minus ACB of the units sold minus fees.
- The gain is reported in the year of the settlement date.
- The inclusion rate is 50%.

## Superficial Loss

- The window runs from 30 days before to 30 days after the sale, inclusive, on settlement dates.
- Purchases in any account count, including TFSA and RRSP.
- Denied share is min(sold, bought in window, held at end of window) divided by sold.
- Denied loss moves to the replacement shares' ACB, or is lost forever when they are in a registered account.
- One purchase can shelter only one loss.
- The denied loss follows the shares still owned when the window closes, so purchases made after the
  sale absorb it before any pre-sale purchase that this disposition may itself have sold.
- A sale whose window has not closed yet is reported with `status: "pending"`: the outcome still
  depends on what the user does next. It becomes `final` once the window end has passed.

## Dividends

- The class follows the issuer, not the listing: a dividend on a U.S. listing pooled with a Canadian
  one (RY on the NYSE) is eligible. The user can set the class for any security.
- Eligible dividends use a 38% gross-up and a 15.0198% federal credit.
- Non-eligible dividends use a 15% gross-up and a 9.0301% federal credit.
- Foreign income has no gross-up or credit, and withholding tax is kept for a foreign tax credit.
- The year summary keeps the grossed-up totals per class, for T1 lines 12000 and 12010.

## Lines on the Return

The Tax Center's "Fill out your return" maps the saved year results to form lines (`src/tax-engine/return-lines.ts`).
Line numbers were checked against CRA's published forms (5006-R and 5000-S3) for 2019 to 2025 (`src/tax-engine/config/return-lines.ts`).

| Form and line | Amount |
| --- | --- |
| Schedule 3, 13199 | Proceeds of every disposition in the year |
| Schedule 3, 13200 | Their total gain or loss, with superficial losses left out |
| T1 12700 | Taxable capital gains; zero for a net loss, which is shown as a loss to carry instead |
| T1 12000 | Taxable amount of eligible and non-eligible dividends (grossed up) |
| T1 12010 | The non-eligible part of line 12000 |
| T1 12100 | Foreign dividends in CAD, before withholding |
| Schedule 1, 40425 | Federal dividend tax credit |
| Form T2209 | Foreign tax withheld, for the credit on line 40500 |

- 2024's Schedule 3 splits dispositions by settlement date: Period 1 (January 1 to June 24) on lines 10689 and 10690, Period 2 (June 25 to December 31) on 13199 and 13200.
- A year CRA has not published forms for yet uses the latest verified year's numbers and says so.
- Readiness checks listed above the lines: tax gaps, sales larger than the known position, unconfirmed account types, superficial loss windows still open, and unverified rates.
- Canadian ETFs that paid distributions into non-registered accounts are named with a pointer to their T3 slips, which hold the real split.
- Schedule 7 and Schedule 15 lines, and T1 lines 20800 and 20805, come from the contribution results (see Contributions and Room).
- Not covered: interest income, line 22100 carrying charges, line 25300 losses of other years, capital gains from T3 and T5 slips (lines 17400 and 17600), Home Buyers' Plan and Lifelong Learning Plan repayments, Form T1135, and provincial forms.

## Contributions and Room

`src/tax-engine/contributions/` tracks cash into and out of every registered plan, room for TFSA, RRSP, and FHSA, and the Schedule 7 and Schedule 15 amounts.
Limits live in `src/tax-engine/config/contribution-limits.ts`, checked against CRA's limits table on 2026-10-08.
Schedule line numbers live in `src/tax-engine/config/contribution-forms.ts`, checked against the e-text of 5000-S7 (2019 to 2025) and 5000-S15 (2023 to 2025).

### Reading the cash flows

- A deposit into a registered investment account is a contribution and a withdrawal is a withdrawal.
  Non-registered and cash accounts never count.
- An internal cash transfer is paired with its other side (same amount and currency, opposite direction, another account, within 3 days, closest first):
  - between two accounts of the same plan type it is a transfer, which counts for nothing;
  - from an RRSP into an FHSA it is an RRSP-to-FHSA transfer;
  - from a non-registered account it is a contribution, and to one a withdrawal;
  - unpaired, or between two different plans, it is read by direction and flagged for review.
- The user can reclassify any synced flow (contribution, withdrawal, same-plan transfer, RRSP to FHSA, not a contribution) and add flows for accounts TaxBack cannot see; a sync never overwrites the choice.
- Amounts are converted to CAD at the Bank of Canada rate for the flow's date.

### Room source

- A figure the user enters from CRA (TFSA room on January 1, the RRSP deduction limit, FHSA participation room) always wins and restarts the chain from that year.
- Otherwise TaxBack estimates from the year before; with nothing to build on the room is unknown rather than guessed.

### TFSA

- Annual limits: $5,000 (2009 to 2012), $5,500 (2013, 2014), $10,000 (2015), $5,500 (2016 to 2018), $6,000 (2019 to 2022), $6,500 (2023), $7,000 (2024 to 2026).
- Room on January 1 = last year's room - last year's contributions + last year's withdrawals + this year's limit.
- The estimate starts in 2009, the year the user turns 18, or the year they became a resident, whichever is latest; it is flagged when the tracked history starts after that.
- A withdrawal never frees room in the same year.
  The part of a withdrawal that removes an excess is not added back next year.
- An excess is taxed at 1% a month on each month's highest excess (Form RC243); months after today are not counted.

### RRSP (Schedule 7)

- A contribution counts for the year whose deadline it beats: the 60th day of the next year, moved to Monday when it falls on a weekend (February 29, 2024; March 3, 2025; March 2, 2026).
- Line 1: unused contributions from earlier years (the user's figure, else TaxBack's carry forward).
  Line 2: contributions from the day after last year's deadline to December 31.
  Line 3: contributions from January 1 to the deadline.
  Line 4 (24500): lines 2 + 3.
  Line 11: the deduction limit.
  Line 20 (17 before 2021) and T1 20800: the deduction.
  Line 23 (18 before 2021): unused contributions to carry forward.
- Estimated limit = last year's limit - last year's deduction + min(18% of last year's earned income, the dollar limit) - last year's pension adjustment.
  Dollar limits: $26,500 (2019) to $33,810 (2026) and $35,390 (2027).
- The deduction is the most allowed (whichever is less of the limit and the contributions available) unless the user claims less; the rest carries forward.
- Undeducted contributions above the limit plus $2,000 are an excess taxed at 1% a month (Form T1-OVP).
  Contributions in the first 60 days count from January 1, which can overstate January and February slightly.
- Withdrawals are listed but their income (T4RSP) is not computed.

### FHSA (Schedule 15)

- Room starts the year the first FHSA was opened (the user's year, else the first FHSA flow; never before 2023).
- Participation room = $8,000 + last year's unused room (at most $8,000), within $40,000 for life of annual limits plus RRSP transfers.
- RRSP-to-FHSA transfers use room first and are not deductible.
  The annual FHSA limit is the contributions that fit in the room left, plus last year's excess.
- Most that can be deducted = whichever is less of (annual limits to date - past deductions) and ($40,000 - past deductions - RRSP transfers to date).
  The user can claim less; unused contributions carry forward.
- Contributions above the room are an excess taxed at 1% a month and carry into next year's limit.
  A withdrawal is read as a designated withdrawal of the excess.
- Lines shown follow each year's form: contributions (line 1, 68935), carryforward, RRSP transfers (68950), annual limit, maximum deduction, unused contributions, the deduction (T1 20805), and the carry forward; the first year notes box 68930.

### Other plans

RESP, RRIF, LIRA, and U.S. retirement accounts list contributions and withdrawals per year; their room is not tracked.

The Tax Center shows the TFSA room check (no form) and asks the user to review unpaired transfers and to enter an unknown RRSP limit.
The Hub alerts on any plan over its room this year.

## From SnapTrade to the Ledger

`src/server/snaptrade/map.ts` turns SnapTrade activities into ledger entries.

| SnapTrade activity | Ledger entry |
| --- | --- |
| `BUY`, `SELL` | `buy`, `sell` |
| `REI` | `drip` |
| `DIVIDEND`, `SUBSTITUTE_DIVIDEND` | `dividend`: eligible for a Canadian listing, foreign otherwise |
| `TAX` on the same day and security as a dividend | that dividend's withholding tax |
| `SPLIT` | `split`, ratio = (units held + units added) / units held in that account |
| `STOCK_DIVIDEND` | `stock_dividend`: the units, and the reported amount as their value |
| `FEE` | `fee` |
| `TRANSFER`, `EXTERNAL_ASSET_TRANSFER_IN/OUT` | `transfer_in` / `transfer_out` |
| `CONTRIBUTION`, `DEPOSIT`, `WITHDRAWAL`, `INTERNAL_CASH_TRANSFER_IN/OUT`, and a `TRANSFER` with no security | a contribution flow (`contribution_flows`), direction from the amount's sign |
| Interest, options, adjustments | not stored; counted in the sync stats |

- Dates are the Toronto calendar day of SnapTrade's UTC timestamp, so an evening trade on December 31 stays in that year.
- A trade that settles in a different currency from the listing (a US stock bought with CAD) uses the cash actually paid or received, from the activity amount.
- Investment and cash accounts are read; credit cards are skipped.
  Cash accounts (chequing, Wealthsimple Cash) count toward total value but hold no securities, so they never affect gains and need no type confirmation.
- Each account's type is guessed from the broker and stays unconfirmed until the user confirms it in the Hub.
  A confirmed type is never overwritten by a later sync.

## Known Limits

- Spouse and affiliated-person purchases are not considered for superficial losses.
- U.S. taxpayers are not supported: no lot-based cost basis, wash sales, short- and long-term split, or 1099-B.
- Form T1135 (foreign property over $100,000 CAD) is not tracked.
- Mapping has only been run against a real Wealthsimple connection; activity types a U.S. broker reports
  that the mapper does not know are skipped and counted, and reconciliation shows any resulting gap.
- Provincial credits are not modelled.
- Contributions: spousal RRSP attribution, Home Buyers' Plan and Lifelong Learning Plan withdrawals and repayments, FHSA qualifying withdrawals and the 15-year closing rule, past-service pension adjustments, PRPP and SPP contributions outside a connected account (enter them by hand), RRSP withdrawal income, and RESP grants are not modelled.
  A direct transfer between institutions that a broker reports as a deposit is read as a contribution until the user reclassifies it.
- Rates are verified for 2019 to 2026 only, and other years raise a warning.
- Quantities are pooled, not tracked per account, so a split is recognised by matching security,
  ratio, and a settlement date within 7 days. Two brokers reporting one split more than 7 days apart
  would be counted twice; reports on different dates inside the tolerance raise
  `split_reported_twice`.
- Brokers report settlement as the trade timestamp (Wealthsimple does), so a trade in the last two business days of December counts in that year rather than the next.
- Without a user choice, the dividend class comes from the listings: a security listed only outside
  Canada is foreign even when the issuer is Canadian, until it is linked with its Canadian listing or
  its class is set.
  Canadian ETF distributions mix eligible dividends, other income, capital gains, and return of capital; the real split is on the T3 slip, and only one class per security can be chosen.
  Return of capital has no SnapTrade activity type, so it is never recorded.
- Options are skipped, so a position created by an exercise or assignment can look short; reconciliation shows the gap.
- Corporate actions are entered by hand. If a broker also reports one as trades or transfers, it would be
  counted twice; reconciliation shows the mismatch.
- A withdrawal in kind from a registered account is not treated as a purchase for superficial loss checks.
- A transfer in from an account that is not connected adds no units to the pool until an opening balance is entered.
- Brokers share limited history through SnapTrade (Wealthsimple: about one year). Positions bought before that have no ACB until the user enters an opening balance.
- A denied loss is apportioned across in-window purchases without lot tracking, so which specific
  replacement shares carry it is an approximation. The total denied is unaffected.
