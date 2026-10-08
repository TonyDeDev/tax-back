"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DELETE_CONFIRMATION } from "@/lib/delete-data";
import { RevokeFailedError, deleteUserData } from "@/server/account-deletion";
import { getAuth } from "@/server/auth";
import { ReadOnlyDemoError, UnauthorizedError, requireWritableUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";
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

/**
 * "Delete my data": revoke TaxBack's SnapTrade access, sign out, then delete the user and everything
 * they own. On success it redirects to the landing page, so it only returns on failure.
 */
export async function deleteMyData(confirmation: string): Promise<ActionResult> {
  let user: { id: string };
  try {
    user = await requireWritableUser();
  } catch (error) {
    if (error instanceof ReadOnlyDemoError || error instanceof UnauthorizedError) return { ok: false, message: error.message };
    throw error;
  }
  if (confirmation.trim() !== DELETE_CONFIRMATION) return { ok: false, message: `Type ${DELETE_CONFIRMATION} to confirm.` };

  const env = getEnv();
  const credentials =
    env.SNAPTRADE_OAUTH_CLIENT_ID && env.SNAPTRADE_OAUTH_CLIENT_SECRET
      ? { clientId: env.SNAPTRADE_OAUTH_CLIENT_ID, clientSecret: env.SNAPTRADE_OAUTH_CLIENT_SECRET }
      : null;
  const auth = getAuth();
  const requestHeaders = await headers();
  try {
    // Revocation runs first inside deleteUserData; signing out before the delete clears the session cookie.
    await deleteUserData(getDb(), auth, user.id, credentials, fetch, async () => {
      await auth.api.signOut({ headers: requestHeaders }).catch(() => undefined);
    });
  } catch (error) {
    if (error instanceof RevokeFailedError) {
      console.error(`[delete] user ${user.id} revoke failed`, error.cause);
      return { ok: false, message: error.message };
    }
    console.error(`[delete] user ${user.id} failed`, error);
    return { ok: false, message: "Your data could not be deleted. Nothing was removed. Try again." };
  }
  redirect("/?deleted=1");
}
