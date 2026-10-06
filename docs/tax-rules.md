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
- The Hub shows "Ledger matches broker positions" as the share of positions that agree.

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
| Deposits, withdrawals, interest, options, adjustments | not stored; counted in the sync stats |

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
