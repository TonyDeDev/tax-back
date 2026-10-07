import { taxYearCsv, taxYearCsvFilename } from "@/lib/tax-csv";
import { requireUserForAction, UnauthorizedError } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getTaxYear, getTaxYears } from "@/server/queries/tax";
import { torontoToday } from "@/server/recompute";

export const dynamic = "force-dynamic";

/** The Tax Center's "Export CSV": the saved results for one year, as a download. */
export async function GET(_request: Request, { params }: RouteContext<"/tax/[year]/export">) {
  let user;
  try {
    user = await requireUserForAction();
  } catch (error) {
    if (error instanceof UnauthorizedError) return new Response("Sign in to continue.", { status: 401 });
    throw error;
  }

  const db = getDb();
  const today = torontoToday();
  const year = Number((await params).year);
  // Only a year the Tax Center offers, so the route cannot be used to probe arbitrary years.
  if (!(await getTaxYears(db, user.id, today)).includes(year)) return new Response("No such tax year.", { status: 404 });

  const csv = taxYearCsv(await getTaxYear(db, user.id, year, today), today);
  // Lead with the UTF-8 BOM: without it Excel on Windows reads an accented security name as mojibake.
  return new Response(`﻿${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${taxYearCsvFilename(year)}"`,
      "cache-control": "no-store",
    },
  });
}
