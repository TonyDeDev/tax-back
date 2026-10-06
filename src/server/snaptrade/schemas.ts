import { z } from "zod";

/*
 * Response shapes for the SnapTrade read endpoints, checked against live OAuth responses
 * (`pnpm snaptrade:probe`). Only the fields TaxBack uses are declared; zod drops the rest.
 * Numbers stay as JSON gives them; `map.ts` is the only place they become decimals.
 */

/** Some endpoints return numbers as JSON numbers, `/positions/all` returns them as strings. */
export const numeric = z.union([z.number(), z.string()]);

const currencyRef = z.object({ code: z.string() });

export const accountSchema = z.object({
  id: z.string(),
  brokerage_authorization: z.string(),
  name: z.string().nullish(),
  number: z.string().nullish(),
  institution_name: z.string(),
  raw_type: z.string().nullish(),
  status: z.string().nullish(),
  /** `INVESTMENT`, `DEPOSIT` (cash), or `LOC` (credit cards, never synced). */
  account_category: z.string().nullish(),
  meta: z
    .object({
      type: z.string().nullish(),
      currency: z.string().nullish(),
      /** SnapTrade's detailed type, e.g. `HISA_PORTFOLIO_NON_REGISTERED` (savings) or `CASH`. */
      unifiedAccountType: z.string().nullish(),
    })
    .nullish(),
  balance: z.object({ total: z.object({ currency: z.string().nullish() }).nullish() }).nullish(),
});
export type SnapTradeAccount = z.infer<typeof accountSchema>;

export const authorizationSchema = z.object({
  id: z.string(),
  disabled: z.boolean().nullish(),
  brokerage: z.object({
    name: z.string(),
    display_name: z.string().nullish(),
    slug: z.string(),
  }),
});
export type SnapTradeAuthorization = z.infer<typeof authorizationSchema>;

/**
 * FIGI metadata, when SnapTrade has it. `figi_share_class` is the same for every listing of the same
 * shares (RY on the TSX and on the NYSE), which is how identical property across listings is pooled.
 */
const figiSchema = z.object({ figi_code: z.string().nullish(), figi_share_class: z.string().nullish() }).nullish();

export const positionSchema = z.object({
  instrument: z.object({
    kind: z.string(),
    id: z.string().nullish(),
    symbol: z.string().nullish(),
    raw_symbol: z.string().nullish(),
    description: z.string().nullish(),
    currency: z.string().nullish(),
    exchange: z.string().nullish(),
    figi_instrument: figiSchema,
  }),
  units: numeric,
  price: numeric.nullish(),
  /** Average cost per unit as the broker reports it. Shown for comparison only, never used for ACB. */
  cost_basis: numeric.nullish(),
  currency: z.string().nullish(),
});
export type SnapTradePosition = z.infer<typeof positionSchema>;

export const positionsResponseSchema = z.object({ results: z.array(positionSchema) });

export const balanceSchema = z.object({ currency: currencyRef.nullish(), cash: z.number().nullish() });
export type SnapTradeBalance = z.infer<typeof balanceSchema>;

/** Only `id` and `type` are required here; activities TaxBack stores are validated in full by the mapper. */
export const activityEnvelopeSchema = z.looseObject({ id: z.string(), type: z.string() });

export const activitiesPageSchema = z.object({
  data: z.array(activityEnvelopeSchema),
  pagination: z.object({ offset: z.number(), limit: z.number(), total: z.number() }),
});

export const symbolSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  raw_symbol: z.string().nullish(),
  description: z.string().nullish(),
  currency: currencyRef,
  exchange: z.object({ code: z.string().nullish(), mic_code: z.string().nullish() }).nullish(),
  type: z.object({ code: z.string().nullish() }).nullish(),
  figi_instrument: figiSchema,
});
export type SnapTradeSymbol = z.infer<typeof symbolSchema>;

export const activitySchema = z.object({
  id: z.string(),
  type: z.string(),
  symbol: symbolSchema.nullish(),
  option_symbol: z.unknown().nullish(),
  currency: currencyRef.nullish(),
  amount: z.number().nullish(),
  price: z.number().nullish(),
  units: z.number().nullish(),
  fee: z.number().nullish(),
  trade_date: z.string().nullish(),
  settlement_date: z.string(),
  description: z.string().nullish(),
});
export type SnapTradeActivity = z.infer<typeof activitySchema>;
