import { eq } from "drizzle-orm";
import type { DerivedRows } from "./ledger";
import * as s from "./schema";
import type { AnyDb } from "./types";

/** Keeps each insert well under Postgres' 65535 bind parameter limit. */
const CHUNK = 500;

function chunks<T>(rows: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/**
 * Replaces every derived row for one user in a single transaction, so readers see either the old
 * results or the new ones, never a mix. Replacements cascade from `superficial_losses`.
 */
export async function replaceDerived(db: AnyDb, userId: string, rows: DerivedRows): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      s.acbEvents,
      s.acbPositions,
      s.realizedGains,
      s.superficialLosses,
      s.incomeEvents,
      s.harvestOpportunities,
      s.taxYearSummaries,
      s.taxWarnings,
    ]) {
      await tx.delete(table).where(eq(table.userId, userId));
    }

    for (const part of chunks(rows.acbPositions)) await tx.insert(s.acbPositions).values(part);
    for (const part of chunks(rows.acbEvents)) await tx.insert(s.acbEvents).values(part);
    for (const part of chunks(rows.realizedGains)) await tx.insert(s.realizedGains).values(part);
    for (const part of chunks(rows.incomeEvents)) await tx.insert(s.incomeEvents).values(part);
    for (const part of chunks(rows.harvestOpportunities)) await tx.insert(s.harvestOpportunities).values(part);
    for (const part of chunks(rows.taxYearSummaries)) await tx.insert(s.taxYearSummaries).values(part);
    for (const part of chunks(rows.taxWarnings)) await tx.insert(s.taxWarnings).values(part);

    for (const part of chunks(rows.superficialLosses)) {
      const inserted = await tx
        .insert(s.superficialLosses)
        .values(part.map((p) => p.loss))
        .returning({ id: s.superficialLosses.id, sale: s.superficialLosses.saleTransactionId });
      // RETURNING order is not guaranteed; the sale is unique per loss, so match on it.
      const idBySale = new Map(inserted.map((r) => [r.sale, r.id]));
      const replacements = part.flatMap((p) =>
        p.replacements.map((r) => ({ ...r, superficialLossId: idBySale.get(p.loss.saleTransactionId)! })),
      );
      for (const sub of chunks(replacements)) await tx.insert(s.superficialLossReplacements).values(sub);
    }
  });
}
