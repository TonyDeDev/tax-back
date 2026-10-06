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
| `FEE` | `fee` |
| `TRANSFER`, `EXTERNAL_ASSET_TRANSFER_IN/OUT` | `transfer_in` / `transfer_out` |
| Deposits, withdrawals, interest, stock dividends, options, adjustments | not stored; counted in the sync stats |

- Dates are the Toronto calendar day of SnapTrade's UTC timestamp, so an evening trade on December 31 stays in that year.
- A trade that settles in a different currency from the listing (a US stock bought with CAD) uses the cash actually paid or received, from the activity amount.
- Only investment accounts are read; credit cards and cash accounts are skipped.
- Each account's type is guessed from the broker and stays unconfirmed until the user confirms it in the Hub.
  A confirmed type is never overwritten by a later sync.

## Known Limits

- Transfers between accounts are flagged and do not change ACB.
- Spouse and affiliated-person purchases are not considered for superficial losses.
- Provincial credits are not modelled.
- Rates are verified for 2019 to 2026 only, and other years raise a warning.
- Quantities are pooled, not tracked per account, so a split is recognised by matching security,
  ratio, and a settlement date within 7 days. Two brokers reporting one split more than 7 days apart
  would be counted twice; reports on different dates inside the tolerance raise
  `split_reported_twice`.
- Brokers report settlement as the trade timestamp (Wealthsimple does), so a trade in the last two business days of December counts in that year rather than the next.
- Dividend class comes from the listing only.
  Canadian ETF distributions mix eligible dividends, other income, capital gains, and return of capital; the real split is on the T3 slip, and there is no override yet.
  Return of capital has no SnapTrade activity type, so it is never recorded.
- Stock dividends and options are skipped, so a position that received them can look short; selling it then raises `opening_balance_needed`.
- Brokers share limited history through SnapTrade (Wealthsimple: about one year). Positions bought before that have no ACB until the user enters an opening balance.
- A denied loss is apportioned across in-window purchases without lot tracking, so which specific
  replacement shares carry it is an approximation. The total denied is unaffected.
