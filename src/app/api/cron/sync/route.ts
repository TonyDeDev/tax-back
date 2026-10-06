import { getAuth } from "@/server/auth";
import { isCronAuthorized, runDailyCron } from "@/server/cron";
import { getDb } from "@/server/db";
import { getEnv } from "@/server/env";

// The Hobby plan allows up to 300 seconds with Fluid compute; the Test OAuth app has at most 5 users.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/** Daily Vercel Cron (`vercel.json`). */
export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), getEnv().CRON_SECRET)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const result = await runDailyCron(getDb(), getAuth());
  return Response.json(result, { headers: { "cache-control": "no-store" } });
}
