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

## Dividends

- Eligible dividends use a 38% gross-up and a 15.0198% federal credit.
- Non-eligible dividends use a 15% gross-up and a 9.0301% federal credit.
- Foreign income has no gross-up or credit, and withholding tax is kept for a foreign tax credit.

## Known Limits

- Transfers between accounts are flagged and do not change ACB.
- Spouse and affiliated-person purchases are not considered for superficial losses.
- Provincial credits are not modelled.
- Rates are verified for 2019 to 2026 only, and other years raise a warning.
