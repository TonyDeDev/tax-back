import { describe, expect, it } from "vitest";
import { type Listing, resolvePools } from "./pools";

const listing = (id: string, over: Partial<Listing> = {}): Listing => ({
  id,
  symbol: id.split("-")[0]!.toUpperCase(),
  exchange: null,
  currency: "CAD",
  country: null,
  figiShareClass: null,
  ...over,
});

// RY trades on the TSX in CAD and on the NYSE in USD; both carry the same share-class FIGI.
const ryTsx = listing("ry-tsx", { exchange: "XTSE", country: "CA", figiShareClass: "BBG001S5S1X6" });
const ryNyse = listing("ry-nyse", { exchange: "XNYS", currency: "USD", country: "US", figiShareClass: "BBG001S5S1X6" });
const aapl = listing("aapl", { exchange: "XNAS", currency: "USD", country: "US", figiShareClass: "BBG001S5N8V8" });

describe("resolvePools", () => {
  it("pools listings with the same share-class FIGI under the Canadian one", () => {
    const pools = resolvePools([ryNyse, aapl, ryTsx], []);
    expect([pools.poolOf("ry-nyse"), pools.poolOf("ry-tsx"), pools.poolOf("aapl")]).toEqual(["ry-tsx", "ry-tsx", "aapl"]);
    expect(pools.listingsOf("ry-tsx").map((l) => [l.id, l.reason])).toEqual([
      ["ry-tsx", "canonical"],
      ["ry-nyse", "figi"],
    ]);
  });

  it("prefers a CAD listing, then a stable order, when no listing is Canadian", () => {
    const usd = listing("x-usd", { currency: "USD", figiShareClass: "F" });
    const cad = listing("x-cad", { currency: "CAD", figiShareClass: "F" });
    expect(resolvePools([usd, cad], []).poolOf("x-usd")).toBe("x-cad");
  });

  it("maps an unknown or unmatched listing to itself", () => {
    const pools = resolvePools([aapl, listing("solo")], []);
    expect([pools.poolOf("solo"), pools.poolOf("never-seen")]).toEqual(["solo", "never-seen"]);
  });

  it("joins listings the user links, even without a FIGI", () => {
    const tdTsx = listing("td-tsx", { country: "CA" });
    const tdNyse = listing("td-nyse", { currency: "USD", country: "US" });
    const pools = resolvePools([tdTsx, tdNyse], [{ securityId: "td-nyse", poolSecurityId: "td-tsx", dividendClass: null }]);
    expect(pools.poolOf("td-nyse")).toBe("td-tsx");
    expect(pools.listingsOf("td-tsx").map((l) => l.reason)).toEqual(["canonical", "linked"]);
  });

  it("keeps a listing separate when the user says so, overriding the FIGI", () => {
    const pools = resolvePools([ryTsx, ryNyse], [{ securityId: "ry-nyse", poolSecurityId: "ry-nyse", dividendClass: null }]);
    expect(pools.poolOf("ry-nyse")).toBe("ry-nyse");
    expect(pools.isSeparate("ry-nyse")).toBe(true);
  });

  it("treats dividends on a U.S. listing of a Canadian company as eligible", () => {
    const pools = resolvePools([ryTsx, ryNyse, aapl], []);
    expect(pools.dividendClassFor("ry-nyse", "foreign")).toBe("eligible");
    expect(pools.dividendClassFor("aapl", "foreign")).toBe("foreign");
    // A non-eligible dividend is never promoted.
    expect(pools.dividendClassFor("ry-nyse", "non_eligible")).toBe("non_eligible");
  });

  it("lets the user's choice win: the listing's own, then the pool's", () => {
    const pools = resolvePools(
      [ryTsx, ryNyse, aapl],
      [
        { securityId: "ry-tsx", poolSecurityId: null, dividendClass: "non_eligible" },
        { securityId: "aapl", poolSecurityId: null, dividendClass: "eligible" },
      ],
    );
    expect(pools.dividendClassFor("ry-nyse", "foreign")).toBe("non_eligible");
    expect(pools.dividendOverride("ry-tsx")).toBe("non_eligible");
    expect(pools.dividendClassFor("aapl", "foreign")).toBe("eligible");
  });
});
