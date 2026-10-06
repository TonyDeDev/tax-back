import "server-only";
import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/server/db";
import * as s from "@/server/db/schema";
import { getAuth } from ".";

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
  isDemo: boolean;
}

export class UnauthorizedError extends Error {
  constructor(message = "Sign in to continue.") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ReadOnlyDemoError extends Error {
  constructor(message = "The demo is read-only. Sign in to use your own data.") {
    super(message);
    this.name = "ReadOnlyDemoError";
  }
}

/**
 * The signed-in user for this request, or null. Cached per request, so a layout and page share one lookup.
 * The profile comes from `user_profiles`; it is created here if the sign-up hook ever failed to write it.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const result = await getAuth().api.getSession({ headers: await headers() });
  if (!result) return null;
  const { user } = result;

  const db = getDb();
  let [profile] = await db
    .select({ isDemo: s.userProfiles.isDemo })
    .from(s.userProfiles)
    .where(eq(s.userProfiles.userId, user.id));
  if (!profile) {
    await db.insert(s.userProfiles).values({ userId: user.id }).onConflictDoNothing();
    profile = { isDemo: false };
  }

  return { id: user.id, name: user.name, email: user.email, image: user.image ?? null, isDemo: profile.isDemo };
});

/**
 * For pages: the signed-in user, or a redirect to sign-in. This is the real access check;
 * `src/proxy.ts` only redirects early when there is no session cookie at all.
 */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  return user;
}

/** For server actions and route handlers, which must fail rather than redirect. */
export async function requireUserForAction(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

/** For actions that change data: the demo user is shared by every visitor, so it may not write. */
export async function requireWritableUser(): Promise<CurrentUser> {
  const user = await requireUserForAction();
  if (user.isDemo) throw new ReadOnlyDemoError();
  return user;
}
