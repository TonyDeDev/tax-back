"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReadOnlyDemoError, UnauthorizedError, requireUserForAction, requireWritableUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { loadUserPools } from "@/server/db/pools";
import type { AnyDb } from "@/server/db/types";
import { loadEngineInput, recomputeUser, torontoToday } from "@/server/recompute";
import { D, PreviewError, previewSale } from "@/tax-engine";

export type ActionResult = { ok: true } | { ok: false; message: string };

/** A sale preview as the page shows it: every number already computed on the server. */
export interface SalePreviewView {
  symbol: string;
  tradeDate: string;
  settlementDate: string;
  quantity: string;
  quantityHeld: string;
  currency: string;
  fxRate: string;
  proceedsCad: string;
  acbCad: string;
  feesCad: string;
  gainCad: string;
  deniedLossCad: string;
  allowedGainCad: string;
  lostForeverCad: string;
  superficialStatus: "pending" | "final" | null;
  windowStart: string;
  windowEnd: string;
  noRebuyBefore: string | null;
  recentPurchases: { date: string; accountType: string; quantity: string }[];
  inclusionRate: string;
  taxableCad: string;
  estimatedTaxCad: string | null;
}

const decimal = z.string().trim().regex(/^\d+(\.\d+)?$/, "Enter a number like 12.5.");
const positive = decimal.refine((v) => new D(v).gt(0), "Enter a number above zero.");
const isoDate = z.iso.date("Enter a date.");

function revalidate(securityId: string) {
  revalidatePath(`/hub/securities/${securityId}`);
  revalidatePath("/hub");
}

async function writableUser(): Promise<{ id: string } | ActionResult> {
  try {
    return await requireWritableUser();
  } catch (error) {
    if (error instanceof ReadOnlyDemoError || error instanceof UnauthorizedError) return { ok: false, message: error.message };
    throw error;
  }
}

/**
 * Applies a change and recomputes in one transaction. If the engine rejects the new ledger the
 * change is rolled back, so a bad entry can never leave the user's tax results stuck.
 */
async function changeAndRecompute(userId: string, securityId: string, change: (tx: AnyDb) => Promise<void>): Promise<ActionResult> {
  try {
    await getDb().transaction(async (tx) => {
      await change(tx);
      await recomputeUser(tx, userId, torontoToday());
    });
  } catch (error) {
    console.error(`[security] user ${userId} change to ${securityId} failed`, error);
    const detail = error instanceof Error && error.message.startsWith("Invalid ledger") ? ` ${error.message.split("\n")[1] ?? ""}` : "";
    return { ok: false, message: `That could not be applied, so nothing was saved.${detail}` };
  }
  revalidate(securityId);
  return { ok: true };
}

const previewInput = z.object({
  securityId: z.uuid(),
  quantity: positive,
  price: decimal,
  fees: decimal,
  currency: z.string().regex(/^[A-Z]{3}$/, "Pick a currency."),
});

/** "What if I sell?": the stored ledger plus one hypothetical sale today. Read-only, so the demo may use it. */
export async function previewSaleAction(raw: {
  securityId: string;
  quantity: string;
  price: string;
  fees: string;
  /** The currency the price is in: one of the pooled listings' currencies. */
  currency: string;
}): Promise<{ ok: true; preview: SalePreviewView } | { ok: false; message: string }> {
  let user;
  try {
    user = await requireUserForAction();
  } catch (error) {
    if (error instanceof UnauthorizedError) return { ok: false, message: error.message };
    throw error;
  }
  const parsed = previewInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the numbers." };
  const { securityId, quantity, price, fees, currency } = parsed.data;

  const db = getDb();
  const today = torontoToday();
  // The engine pools listings under the canonical id; a sale can be priced in any pooled listing's currency.
  const { pools } = await loadUserPools(db, user.id);
  const pool = pools.poolOf(securityId);
  const currencies = new Set(["CAD", ...pools.listingsOf(pool).map((l) => l.currency)]);
  if (!currencies.has(currency)) return { ok: false, message: "Pick one of this security's currencies." };

  try {
    const { input } = await loadEngineInput(db, user.id, today);
    const p = previewSale({
      ...input,
      sale: { securityId: pool, quantity: new D(quantity), price: new D(price), currency, fees: new D(fees) },
    });
    return {
      ok: true,
      preview: {
        symbol: p.symbol,
        tradeDate: p.tradeDate,
        settlementDate: p.settlementDate,
        quantity,
        quantityHeld: p.quantityHeld.toString(),
        currency,
        fxRate: p.fxRate.toString(),
        proceedsCad: p.gain.proceedsCad.toFixed(2),
        acbCad: p.gain.acbCad.toFixed(2),
        feesCad: p.gain.feesCad.toFixed(2),
        gainCad: p.gain.gainCad.toFixed(2),
        deniedLossCad: p.gain.deniedLossCad.toFixed(2),
        allowedGainCad: p.gain.allowedGainCad.toFixed(2),
        lostForeverCad: (p.superficial?.lostForeverCad ?? new D(0)).toFixed(2),
        superficialStatus: p.superficial?.status ?? null,
        windowStart: p.windowStart,
        windowEnd: p.windowEnd,
        noRebuyBefore: p.noRebuyBefore,
        recentPurchases: p.recentPurchases.map((r) => ({ date: r.date, accountType: r.accountType, quantity: r.quantity.toString() })),
        inclusionRate: p.inclusionRate.toString(),
        taxableCad: p.taxableCad.toFixed(2),
        estimatedTaxCad: p.estimatedTaxCad ? p.estimatedTaxCad.toFixed(2) : null,
      },
    };
  } catch (error) {
    if (error instanceof PreviewError) return { ok: false, message: error.message };
    console.error(`[preview] user ${user.id} security ${securityId} failed`, error);
    return { ok: false, message: "The preview could not be computed. Try refreshing your data first." };
  }
}

const openingInput = z.object({
  securityId: z.uuid(),
  quantity: decimal,
  acbCad: decimal,
  asOfDate: isoDate,
  note: z.string().trim().max(200).optional(),
});

/**
 * The user's starting position for a security whose history is incomplete: units and total ACB in CAD
 * at the start of `asOfDate`. It replaces earlier non-registered history for that security.
 */
export async function saveOpeningBalance(raw: z.input<typeof openingInput>): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = openingInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the values." };
  const { securityId, quantity, acbCad, asOfDate, note } = parsed.data;
  if (asOfDate > torontoToday()) return { ok: false, message: "The date cannot be in the future." };

  return changeAndRecompute(user.id, securityId, async (tx) => {
    await tx
      .insert(s.manualAdjustments)
      .values({ userId: user.id, securityId, quantity, acbCad, asOfDate, note: note || null })
      .onConflictDoUpdate({
        target: [s.manualAdjustments.userId, s.manualAdjustments.securityId],
        set: { quantity, acbCad, asOfDate, note: note || null },
      });
  });
}

export async function deleteOpeningBalance(securityId: string): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  if (!z.uuid().safeParse(securityId).success) return { ok: false, message: "That security was not found." };
  return changeAndRecompute(user.id, securityId, async (tx) => {
    await tx
      .delete(s.manualAdjustments)
      .where(and(eq(s.manualAdjustments.userId, user.id), eq(s.manualAdjustments.securityId, securityId)));
  });
}

const corporateInput = z
  .object({
    securityId: z.uuid(),
    kind: z.enum(s.CORPORATE_ACTION_KINDS),
    targetSecurityId: z.uuid("Pick the other security."),
    effectiveDate: isoDate,
    ratio: positive,
    oldFmv: decimal.optional().or(z.literal("")),
    newFmv: decimal.optional().or(z.literal("")),
    cashPerShare: decimal.optional().or(z.literal("")),
  })
  .refine((v) => v.targetSecurityId !== v.securityId, { message: "Pick a different security." })
  .refine((v) => v.kind !== "spinoff" || (!!v.oldFmv && new D(v.oldFmv).gt(0) && !!v.newFmv && new D(v.newFmv).gt(0)), {
    message: "A spinoff needs both fair market values to split the ACB.",
  })
  .refine((v) => v.kind !== "merger" || !v.cashPerShare || new D(v.cashPerShare).isZero() || (!!v.newFmv && new D(v.newFmv).gt(0)), {
    message: "A merger with cash needs the new share's fair market value.",
  });

/** Records a spinoff or merger, which SnapTrade does not report in a form the engine can use. */
export async function saveCorporateAction(raw: z.input<typeof corporateInput>): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = corporateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Check the values." };
  const v = parsed.data;
  if (v.effectiveDate > torontoToday()) return { ok: false, message: "The date cannot be in the future." };

  const db = getDb();
  const [security] = await db.select({ currency: s.securities.currency }).from(s.securities).where(eq(s.securities.id, v.securityId));
  const [target] = await db.select({ id: s.securities.id }).from(s.securities).where(eq(s.securities.id, v.targetSecurityId));
  if (!security || !target) return { ok: false, message: "That security was not found." };

  return changeAndRecompute(user.id, v.securityId, async (tx) => {
    await tx.insert(s.corporateActions).values({
      userId: user.id,
      kind: v.kind,
      securityId: v.securityId,
      targetSecurityId: v.targetSecurityId,
      effectiveDate: v.effectiveDate,
      currency: security.currency,
      ratio: v.ratio,
      oldFmv: v.oldFmv || null,
      newFmv: v.newFmv || null,
      cashPerShare: v.kind === "merger" && v.cashPerShare ? v.cashPerShare : "0",
    });
  });
}

export async function deleteCorporateAction(securityId: string, id: string): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(securityId).success) {
    return { ok: false, message: "That corporate action was not found." };
  }
  return changeAndRecompute(user.id, securityId, async (tx) => {
    await tx.delete(s.corporateActions).where(and(eq(s.corporateActions.id, id), eq(s.corporateActions.userId, user.id)));
  });
}

/** Upserts one listing's preferences, leaving the field not given untouched. */
async function setPreference(
  tx: AnyDb,
  userId: string,
  securityId: string,
  change: { poolSecurityId?: string | null; dividendClass?: (typeof s.DIVIDEND_CLASSES)[number] | null },
) {
  await tx
    .insert(s.securityPreferences)
    .values({ userId, securityId, poolSecurityId: change.poolSecurityId ?? null, dividendClass: change.dividendClass ?? null })
    .onConflictDoUpdate({ target: [s.securityPreferences.userId, s.securityPreferences.securityId], set: change });
}

const linkInput = z.object({ poolId: z.uuid(), listingId: z.uuid() }).refine((v) => v.poolId !== v.listingId, {
  message: "Pick a different security.",
});

/** The user says another listing is the same shares as this pool (identical property), so its ACB is pooled. */
export async function linkListing(poolId: string, listingId: string): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = linkInput.safeParse({ poolId, listingId });
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Pick a security." };
  return changeAndRecompute(user.id, poolId, (tx) => setPreference(tx, user.id, listingId, { poolSecurityId: poolId }));
}

/**
 * Keeps a listing out of this pool. `separate` overrides a matching FIGI; `automatic` goes back to
 * following it.
 */
export async function unlinkListing(poolId: string, listingId: string, mode: "separate" | "automatic"): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  if (!z.uuid().safeParse(poolId).success || !z.uuid().safeParse(listingId).success) {
    return { ok: false, message: "That listing was not found." };
  }
  return changeAndRecompute(user.id, poolId, (tx) =>
    setPreference(tx, user.id, listingId, { poolSecurityId: mode === "separate" ? listingId : null }),
  );
}

const dividendInput = z.object({ poolId: z.uuid(), dividendClass: z.enum([...s.DIVIDEND_CLASSES, "automatic"]) });

/** The class every dividend in this pool gets, for when the listing does not reveal the issuer's country. */
export async function setDividendClass(poolId: string, dividendClass: string): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = dividendInput.safeParse({ poolId, dividendClass });
  if (!parsed.success) return { ok: false, message: "Pick a dividend class." };
  const choice = parsed.data.dividendClass === "automatic" ? null : parsed.data.dividendClass;
  return changeAndRecompute(user.id, poolId, (tx) => setPreference(tx, user.id, poolId, { dividendClass: choice }));
}
