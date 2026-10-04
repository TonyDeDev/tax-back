import Decimal from "decimal.js";

/** Decimal constructor with fixed precision for every money, quantity, and FX value in the engine. */
export const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Dec = Decimal;

export const ZERO: Dec = new D(0);
