import type { YearConfig } from "./config/rates";
import { yearOf } from "./dates";
import { ZERO, type Dec } from "./decimal";
import type { IncomeEvent, LedgerEntry } from "./types";

/**
 * Build the income record for a dividend paid into a non-registered account.
 * Eligible and non-eligible dividends are grossed up and earn the federal credit.
 * Foreign income gets neither; withholding tax is carried so the user can claim a foreign tax credit.
 */
export function incomeFromDividend(entry: LedgerEntry, fxRate: Dec, config: YearConfig): IncomeEvent | null {
  if (!entry.dividendClass) return null;
  const amountCad = entry.amount.times(fxRate);
  const rates =
    entry.dividendClass === "eligible" ? config.eligible : entry.dividendClass === "non_eligible" ? config.nonEligible : null;
  const grossedUpCad = rates ? amountCad.times(rates.grossUp) : amountCad;
  return {
    entryId: entry.id,
    securityId: entry.securityId,
    symbol: entry.symbol,
    accountId: entry.accountId,
    date: entry.tradeDate,
    year: yearOf(entry.tradeDate),
    dividendClass: entry.dividendClass,
    amountCad,
    grossedUpCad,
    federalCreditCad: rates ? grossedUpCad.times(rates.federalCredit) : ZERO,
    withholdingCad: (entry.withholdingTax ?? ZERO).times(fxRate),
  };
}
