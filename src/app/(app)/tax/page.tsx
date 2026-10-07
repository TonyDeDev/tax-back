import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getTaxYears } from "@/server/queries/tax";
import { torontoToday } from "@/server/recompute";
import { yearOf } from "@/tax-engine/dates";

/** The nav links here; the newest year with results decides where it lands. */
export default async function TaxCenterIndex() {
  const user = await requireUser("/tax");
  const today = torontoToday();
  const years = await getTaxYears(getDb(), user.id, today);
  // `getTaxYears` always includes the year in progress, so the list is never empty.
  redirect(`/tax/${years[0] ?? yearOf(today)}`);
}
