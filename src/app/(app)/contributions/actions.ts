"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isoDate, optionalDollars, optionalYear, positive } from "@/lib/zod-inputs";
import { ReadOnlyDemoError, UnauthorizedError, requireWritableUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import type { AnyDb } from "@/server/db/types";
import { recomputeUser, torontoToday } from "@/server/recompute";

export type ActionResult = { ok: true } | { ok: false; message: string };

async function writableUser(): Promise<{ id: string } | ActionResult> {
  try {
    return await requireWritableUser();
  } catch (error) {
    if (error instanceof ReadOnlyDemoError || error instanceof UnauthorizedError) return { ok: false, message: error.message };
    throw error;
  }
}

/** Applies a change and recomputes in one transaction, so a change the engine cannot use is never kept. */
async function changeAndRecompute(userId: string, what: string, change: (tx: AnyDb) => Promise<void>): Promise<ActionResult> {
  try {
    await getDb().transaction(async (tx) => {
      await change(tx);
      await recomputeUser(tx, userId, torontoToday());
    });
  } catch (error) {
    console.error(`[contributions] user ${userId} ${what} failed`, error);
    const detail = error instanceof Error && error.message.startsWith("No ") ? ` ${error.message}.` : "";
    return { ok: false, message: `That could not be applied, so nothing was saved.${detail}` };
  }
  revalidatePath("/contributions", "layout");
  revalidatePath("/tax", "layout");
  revalidatePath("/hub");
  return { ok: true };
}

const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Check the values.";

const reclassifyInput = z.object({
  flowId: z.uuid(),
  classification: z.enum([...s.FLOW_CLASSIFICATIONS, "auto"]),
});

/** The user's reading of a cash flow; `auto` goes back to TaxBack's own. */
export async function reclassifyFlow(raw: { flowId: string; classification: string }): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = reclassifyInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const { flowId, classification } = parsed.data;
  return changeAndRecompute(user.id, `reclassify ${flowId}`, async (tx) => {
    const updated = await tx
      .update(s.contributionFlows)
      .set({ classification: classification === "auto" ? null : classification })
      .where(and(eq(s.contributionFlows.id, flowId), eq(s.contributionFlows.userId, user.id)))
      .returning({ id: s.contributionFlows.id });
    if (updated.length === 0) throw new Error(`Flow ${flowId} not found`);
  });
}

const manualInput = z
  .object({
    plan: z.enum(s.PLAN_TYPES),
    kind: z.enum(["contribution", "withdrawal", "rrsp_to_fhsa"]),
    date: isoDate,
    amount: z.string().trim().transform((v) => v.replace(/[$,\s]/g, "")).pipe(positive),
    description: z.string().trim().max(200, "Keep the note under 200 characters."),
  })
  .refine((v) => v.kind !== "rrsp_to_fhsa" || v.plan === "fhsa", { message: "A transfer from an RRSP goes into an FHSA." })
  .refine((v) => v.date >= "2009-01-01", { message: "Enter a date from 2009 on." })
  .refine((v) => v.date <= torontoToday(), { message: "The date cannot be in the future." });

/** A contribution TaxBack cannot see: a group RRSP through work, or an account at another institution. */
export async function addManualContribution(raw: {
  plan: string;
  kind: string;
  date: string;
  amount: string;
  description: string;
}): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = manualInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const v = parsed.data;
  return changeAndRecompute(user.id, "add manual contribution", async (tx) => {
    await tx.insert(s.contributionFlows).values({
      userId: user.id,
      source: "manual",
      plan: v.plan,
      flowDate: v.date,
      direction: v.kind === "withdrawal" ? "out" : "in",
      amount: v.amount,
      currency: "CAD",
      description: v.description === "" ? null : v.description,
      classification: v.kind,
    });
  });
}

export async function deleteManualContribution(raw: { flowId: string }): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = z.object({ flowId: z.uuid() }).safeParse(raw);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  return changeAndRecompute(user.id, "delete manual contribution", async (tx) => {
    const deleted = await tx
      .delete(s.contributionFlows)
      .where(
        and(
          eq(s.contributionFlows.id, parsed.data.flowId),
          eq(s.contributionFlows.userId, user.id),
          eq(s.contributionFlows.source, "manual"),
        ),
      )
      .returning({ id: s.contributionFlows.id });
    if (deleted.length === 0) throw new Error(`Manual flow ${parsed.data.flowId} not found`);
  });
}

const inputsInput = z.object({
  plan: z.enum(s.ROOM_PLANS),
  year: z.number().int().min(2009).max(2100),
  officialRoom: optionalDollars,
  unusedCarriedForward: optionalDollars,
  earnedIncomePriorYear: optionalDollars,
  pensionAdjustment: optionalDollars,
  deductionClaimed: optionalDollars,
});

/** CRA's figures for one plan and year, the RRSP estimate inputs, and the deduction claimed. All blank removes the row. */
export async function saveContributionInputs(raw: {
  plan: string;
  year: number;
  officialRoom: string;
  unusedCarriedForward: string;
  earnedIncomePriorYear: string;
  pensionAdjustment: string;
  deductionClaimed: string;
}): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = inputsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const v = parsed.data;
  const values = {
    officialRoomCad: v.officialRoom,
    unusedCarriedForwardCad: v.unusedCarriedForward,
    earnedIncomePriorYearCad: v.earnedIncomePriorYear,
    pensionAdjustmentCad: v.pensionAdjustment,
    deductionClaimedCad: v.deductionClaimed,
  };
  const key = and(
    eq(s.contributionInputs.userId, user.id),
    eq(s.contributionInputs.plan, v.plan),
    eq(s.contributionInputs.taxYear, v.year),
  );
  return changeAndRecompute(user.id, `save ${v.plan} ${v.year} inputs`, async (tx) => {
    if (Object.values(values).every((x) => x === null)) {
      await tx.delete(s.contributionInputs).where(key);
      return;
    }
    await tx
      .insert(s.contributionInputs)
      .values({ userId: user.id, plan: v.plan, taxYear: v.year, ...values })
      .onConflictDoUpdate({
        target: [s.contributionInputs.userId, s.contributionInputs.plan, s.contributionInputs.taxYear],
        set: values,
      });
  });
}

const profileInput = z.object({
  birthYear: optionalYear(1900, 2100, "Enter your birth year, like 1990."),
  residentSinceYear: optionalYear(1900, 2100, "Enter the year you became a resident, like 2015."),
  fhsaOpenedYear: optionalYear(2023, 2100, "FHSAs exist since 2023: enter 2023 or later."),
});

/** What TaxBack needs to estimate room when the user has no CRA figure. */
export async function saveContributionProfile(raw: {
  birthYear: string;
  residentSinceYear: string;
  fhsaOpenedYear: string;
}): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const parsed = profileInput.safeParse(raw);
  if (!parsed.success) return { ok: false, message: firstIssue(parsed.error) };
  const thisYear = Number(torontoToday().slice(0, 4));
  const v = parsed.data;
  if ([v.birthYear, v.residentSinceYear, v.fhsaOpenedYear].some((y) => y !== null && y > thisYear)) {
    return { ok: false, message: "A year cannot be in the future." };
  }
  return changeAndRecompute(user.id, "save contribution profile", async (tx) => {
    await tx.update(s.userProfiles).set(v).where(eq(s.userProfiles.userId, user.id));
  });
}
