import { ZERO, type Dec } from "./decimal";

/** Tax on net capital gains at a user-chosen marginal rate. A net capital loss produces no tax. */
export function estimateCapitalGainsTax(taxableCapitalGainCad: Dec, marginalRate: Dec | null | undefined): Dec | null {
  if (marginalRate === null || marginalRate === undefined) return null;
  return taxableCapitalGainCad.gt(0) ? taxableCapitalGainCad.times(marginalRate) : ZERO;
}
