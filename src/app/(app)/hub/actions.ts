"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getAuth } from "@/server/auth";
import { ReadOnlyDemoError, UnauthorizedError, requireWritableUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { getLastSync } from "@/server/queries/hub";
import { recomputeUser, torontoToday } from "@/server/recompute";
import { type SyncOutcome, syncUser } from "@/server/sync/sync";

export type ActionResult = { ok: true } | { ok: false; message: string };

function refresh() {
  revalidatePath("/hub");
  revalidatePath("/settings");
}

async function writableUser(): Promise<{ id: string } | ActionResult> {
  try {
    return await requireWritableUser();
  } catch (error) {
    if (error instanceof ReadOnlyDemoError || error instanceof UnauthorizedError) return { ok: false, message: error.message };
    throw error;
  }
}

function toResult(outcome: SyncOutcome): ActionResult {
  switch (outcome.status) {
    case "succeeded":
      return { ok: true };
    case "failed":
      return { ok: false, message: outcome.message };
    case "in_progress":
      return { ok: false, message: "A sync is already running. It will show up here when it finishes." };
    case "cooldown": {
      const minutes = Math.max(1, Math.ceil((outcome.retryAt.getTime() - Date.now()) / 60_000));
      return { ok: false, message: `You can refresh again in ${minutes} min.` };
    }
  }
}

/** The Refresh button: at most once per 15 minutes. */
export async function refreshNow(): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const outcome = await syncUser(getDb(), getAuth(), user.id, "manual");
  refresh();
  return toResult(outcome);
}

/** The first read after SnapTrade access is granted. A no-op once any sync has been attempted. */
export async function firstSync(): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const db = getDb();
  if (await getLastSync(db, user.id)) {
    refresh();
    return { ok: true };
  }
  const outcome = await syncUser(db, getAuth(), user.id, "connect");
  refresh();
  return toResult(outcome);
}

const confirmInput = z.object({ accountId: z.uuid(), accountType: z.enum(s.ACCOUNT_TYPES) });

/** The user confirms what kind of account this is, which decides whether its sales are taxable. */
export async function confirmAccountType(accountId: string, accountType: string): Promise<ActionResult> {
  const user = await writableUser();
  if ("ok" in user) return user;
  const input = confirmInput.safeParse({ accountId, accountType });
  if (!input.success) return { ok: false, message: "That account type is not valid." };

  const db = getDb();
  const updated = await db
    .update(s.brokerageAccounts)
    .set({ accountType: input.data.accountType, accountTypeConfirmedAt: new Date() })
    .where(and(eq(s.brokerageAccounts.id, input.data.accountId), eq(s.brokerageAccounts.userId, user.id)))
    .returning({ id: s.brokerageAccounts.id });
  if (updated.length === 0) return { ok: false, message: "That account was not found." };

  try {
    await recomputeUser(db, user.id, torontoToday());
  } catch (error) {
    console.error(`[recompute] user ${user.id} failed after an account type change`, error);
    refresh();
    return { ok: false, message: "The type was saved, but the tax results could not be updated. Refresh to try again." };
  }
  refresh();
  return { ok: true };
}
