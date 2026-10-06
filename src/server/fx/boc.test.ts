import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as s from "@/server/db/schema";
import { FxSourceError, latestRates, parseValet, syncFxRates } from "./boc";

let client: PGlite;
let db: PgliteDatabase<typeof s>;

beforeAll(async () => {
  client = new PGlite();
  db = drizzle({ client, schema: s });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../../drizzle") });
});

afterAll(async () => {
  await client.close();
});

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("parseValet", () => {
  it("reads the series and drops empty or malformed observations", () => {
    const rows = parseValet(
      {
        observations: [
          { d: "2026-09-29", FXUSDCAD: { v: "1.4188" } },
          { d: "2026-09-30", FXUSDCAD: { v: "" } },
          { d: "2026-10-01", FXEURCAD: { v: "1.6" } },
          { d: "bad", FXUSDCAD: { v: "1.4" } },
        ],
      },
      "USD",
    );
    expect(rows).toEqual([{ rateDate: "2026-09-29", cadPerUnit: "1.4188" }]);
  });

  it("rejects a response that is not a Valet series", () => {
    expect(() => parseValet({ nope: true }, "USD")).toThrow(FxSourceError);
  });
});

describe("syncFxRates", () => {
  it("fetches only the missing range, skips CAD, and reports unpublished currencies", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = new URL(input);
        requested.push(`${url.pathname.split("/")[3]} ${url.searchParams.get("start_date")}..${url.searchParams.get("end_date")}`);
        if (url.pathname.includes("FXXYZCAD")) return json({ message: "Series not found" }, 404);
        return json({
          observations: [
            { d: "2026-09-29", FXUSDCAD: { v: "1.4188" } },
            { d: "2026-10-01", FXUSDCAD: { v: "1.4243" } },
          ],
        });
      }),
    );

    const first = await syncFxRates(db, ["CAD", "USD", "XYZ", "USD"], "2026-10-01", "2026-10-05");
    expect(first).toEqual({ inserted: 2, unsupported: ["XYZ"] });
    expect(requested).toEqual(["FXUSDCAD 2026-09-21..2026-10-05", "FXXYZCAD 2026-09-21..2026-10-05"]);

    // Covered already: only the days after the latest stored rate are asked for, and repeats are no-ops.
    requested.length = 0;
    const second = await syncFxRates(db, ["USD"], "2026-10-01", "2026-10-05");
    expect(requested).toEqual(["FXUSDCAD 2026-10-02..2026-10-05"]);
    expect(second.inserted).toBe(0);

    // Older history than what is stored: backfill from the new start.
    requested.length = 0;
    await syncFxRates(db, ["USD"], "2026-01-10", "2026-10-05");
    expect(requested).toEqual(["FXUSDCAD 2025-12-31..2026-10-05"]);
  });

  it("fails clearly when the Bank of Canada is down", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    await expect(syncFxRates(db, ["EUR"], "2026-10-01", "2026-10-05")).rejects.toThrow(/Bank of Canada returned 503/);
  });

  it("returns the latest rate on or before a date, with CAD as 1", async () => {
    const rates = await latestRates(db, ["CAD", "USD"], "2026-09-30");
    expect(Object.fromEntries(rates)).toEqual({ CAD: "1", USD: "1.4188000000" });
  });
});
