import { runLedger } from "./acb";
import { yearConfig } from "./config/rates";
import { yearOf } from "./dates";
import { ZERO, type Dec } from "./decimal";
import { summarizeYears } from "./gains";
import { findHarvestOpportunities } from "./harvest";
import { sortLedger, validateLedger } from "./ledger";
import { dropSupersededEntries, openingEntries } from "./missing-history";
import { reconcile } from "./reconcile";
import type {
  BrokerPosition,
  FxLookup,
  LedgerEntry,
  MarketPrice,
  OpeningAdjustment,
  TaxResult,
  Warning,
} from "./types";

export interface ComputeTaxInput {
  ledger: readonly LedgerEntry[];
  openings?: readonly OpeningAdjustment[];
  fx: FxLookup;
  /** Today, supplied by the caller (the engine never reads the clock). Used for harvesting. */
  asOfDate: string;
  /** Latest price per securityId, for harvesting. */
  prices?: Readonly<Record<string, MarketPrice>>;
  /** User-chosen marginal rate, e.g. 0.4. Without it no tax estimate is produced. */
  marginalRate?: Dec | null;
  /** What the brokers hold today. Without it no reconciliation is produced. */
  brokerPositions?: readonly BrokerPosition[];
}

export function computeTax(input: ComputeTaxInput): TaxResult {
  const openings = input.openings ?? [];
  const errors = validateLedger(input.ledger);
  if (errors.length > 0) throw new Error(`Invalid ledger:\n${errors.join("\n")}`);

  const sorted = sortLedger([...dropSupersededEntries(input.ledger, openings), ...openingEntries(openings)]);
  const run = runLedger(sorted, input.fx, yearConfig, input.asOfDate);
  const years = summarizeYears(run.gains, run.income, yearConfig, input.marginalRate);

  const warnings: Warning[] = [...run.warnings];
  for (const y of years) {
    if (yearConfig(y.year).assumed) warnings.push({ type: "assumed_year_config", year: y.year });
  }

  const asOfYear = yearOf(input.asOfDate);
  const netGainYtd = years.find((y) => y.year === asOfYear)?.netCapitalGainCad ?? ZERO;
  const harvest = findHarvestOpportunities({
    positions: run.positions,
    sorted,
    prices: input.prices ?? {},
    asOfDate: input.asOfDate,
    fx: input.fx,
    netGainYtdCad: netGainYtd,
    inclusionRate: yearConfig(asOfYear).inclusionRate,
    marginalRate: input.marginalRate,
  });

  const reconciliation = input.brokerPositions
    ? reconcile(sorted, run.poolQuantities, input.brokerPositions)
    : { rows: [], matched: 0, total: 0 };

  return {
    positions: run.positions,
    acbEvents: run.acbEvents,
    gains: run.gains,
    superficialLosses: run.superficialLosses,
    income: run.income,
    reconciliation,
    warnings,
    years,
    harvest,
  };
}
