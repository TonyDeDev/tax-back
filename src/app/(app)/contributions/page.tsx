import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db";
import { getContributionYears } from "@/server/queries/contributions";
import { torontoToday } from "@/server/recompute";
import { yearOf } from "@/tax-engine/dates";

/** The nav links here; it lands on the year in progress, which `getContributionYears` always includes. */
export default async function ContributionsIndex() {
  const user = await requireUser("/contributions");
  const today = torontoToday();
  const years = await getContributionYears(getDb(), user.id, today);
  redirect(`/contributions/${years[0] ?? yearOf(today)}`);
}
