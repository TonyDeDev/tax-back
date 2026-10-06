"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ReadOnlyDemoError, UnauthorizedError, requireWritableUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { recomputeUser, torontoToday } from "@/server/recompute";
import { D } from "@/tax-engine";

export type ActionResult = { ok: true } | { ok: false; message: string };

/** A percent such as "43.41", or blank to remove the estimate. Stored as a fraction with 5 decimals. */
const rateInput = z
  .string()
  .trim()
  .regex(/^(\d{1,2}(\.\d{1,3})?)?$/, "Enter a percent between 0 and 99.999, such as 43.41.");

/** The user's combined federal and provincial marginal rate, used for every tax estimate. */
export async function setMarginalRate(percent: string): Promise<ActionResult> {
  let user: { id: string };
  try {
    user = await requireWritableUser();
  } catch (error) {
    if (error instanceof ReadOnlyDemoError || error instanceof UnauthorizedError) return { ok: false, message: error.message };
    throw error;
  }
  const input = rateInput.safeParse(percent);
  if (!input.success) return { ok: false, message: input.error.issues[0]?.message ?? "That rate is not valid." };

  const marginalRate = input.data === "" ? null : new D(input.data).div(100).toFixed(5);
  const db = getDb();
  await db.update(s.userProfiles).set({ marginalRate }).where(eq(s.userProfiles.userId, user.id));
  try {
    await recomputeUser(db, user.id, torontoToday());
  } catch (error) {
    console.error(`[recompute] user ${user.id} failed after a marginal rate change`, error);
    return { ok: false, message: "The rate was saved, but the estimates could not be updated. Refresh to try again." };
  } finally {
    revalidatePath("/hub");
    revalidatePath("/settings");
    revalidatePath("/tax", "layout");
  }
  return { ok: true };
}
