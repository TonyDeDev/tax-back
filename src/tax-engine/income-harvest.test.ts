import { describe, expect, it } from "vitest";
import { yearConfig } from "./config/rates";
import { addDays, isIsoDate } from "./dates";
import { D } from "./decimal";
import { estimateCapitalGainsTax } from "./estimate";
import { computeTax } from "./index";
import { isRegistered } from "./registered";
import { d, entry, flatFx } from "./test-helpers";

describe("dividends", () => {
  const run = (cls: "eligible" | "non_eligible" | "foreign", extra = {}) =>
    computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
        entry({ kind: "dividend", date: "2025-03-01", amount: 1000, cls, ...extra }),
      ],
      fx: flatFx(),
      asOfDate: "2025-12-31",
    });

  it("grosses up and credits eligible dividends", () => {
    const i = run("eligible").income[0]!;
    expect(i.grossedUpCad.toFixed(2)).toBe("1380.00");
    expect(i.federalCreditCad.toFixed(2)).toBe("207.27");
  });

  it("grosses up and credits non-eligible dividends", () => {
    const i = run("non_eligible").income[0]!;
    expect(i.grossedUpCad.toFixed(2)).toBe("1150.00");
    expect(i.federalCreditCad.toFixed(2)).toBe("103.85");
  });

  it("foreign income has no gross-up or credit and keeps withholding", () => {
    const r = run("foreign", { withholding: 150 });
    expect(r.income[0]!.grossedUpCad.toFixed(2)).toBe("1000.00");
    expect(r.income[0]!.federalCreditCad.toFixed(2)).toBe("0.00");
    expect(r.years[0]!.foreignWithholdingCad.toFixed(2)).toBe("150.00");
  });

  it("ignores dividends in registered accounts", () => {
    const r = computeTax({
      ledger: [entry({ kind: "dividend", date: "2025-03-01", amount: 1000, cls: "eligible", type: "tfsa" })],
      fx: flatFx(),
      asOfDate: "2025-12-31",
    });
    expect(r.income).toHaveLength(0);
  });
});

describe("year summary and estimate", () => {
  it("applies the 50% inclusion rate and a marginal-rate estimate", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10 }),
        entry({ kind: "sell", date: "2025-06-02", qty: 100, price: 20 }),
      ],
      fx: flatFx(),
      asOfDate: "2025-12-31",
      marginalRate: d("0.4"),
    });
    const y = r.years[0]!;
    expect(y.netCapitalGainCad.toFixed(2)).toBe("1000.00");
    expect(y.taxableCapitalGainCad.toFixed(2)).toBe("500.00");
    expect(y.estimatedTaxCad!.toFixed(2)).toBe("200.00");
  });

  it("gives no estimate without a rate and no tax on a net loss", () => {
    expect(estimateCapitalGainsTax(d(500), null)).toBeNull();
    expect(estimateCapitalGainsTax(d(-500), d("0.4"))!.toFixed(2)).toBe("0.00");
  });

  it("warns when a year falls outside the rate table", () => {
    const r = computeTax({
      ledger: [
        entry({ kind: "buy", date: "2030-01-02", qty: 1, price: 1 }),
        entry({ kind: "sell", date: "2030-02-02", qty: 1, price: 2 }),
      ],
      fx: flatFx(),
      asOfDate: "2030-12-31",
    });
    expect(r.warnings.map((w) => w.type)).toContain("assumed_year_config");
    expect(yearConfig(2025).assumed).toBe(false);
  });
});

describe("harvesting", () => {
  const base = (buyDate: string) =>
    computeTax({
      ledger: [
        entry({ kind: "buy", date: "2025-01-02", qty: 100, price: 10, security: "GAIN" }),
        entry({ kind: "sell", date: "2025-02-02", qty: 100, price: 18, security: "GAIN" }),
        entry({ kind: "buy", date: buyDate, qty: 100, price: 20, security: "LOSE" }),
      ],
      fx: flatFx(),
      asOfDate: "2025-09-01",
      prices: { LOSE: { price: d(15), currency: "CAD" } },
      marginalRate: d("0.4"),
    });

  it("finds an unrealized loss that can offset gains", () => {
    const h = base("2025-01-05").harvest[0]!;
    expect(h.unrealizedLossCad.toFixed(2)).toBe("500.00");
    expect(h.gainsAvailableToOffsetCad.toFixed(2)).toBe("800.00");
    expect(h.estimatedTaxSavingsCad!.toFixed(2)).toBe("100.00");
    expect(h.blockedByRecentPurchase).toBe(false);
    expect(h.earliestSafeSaleDate).toBe("2025-09-01");
    expect(h.noRebuyBefore).toBe("2025-10-02");
  });

  it("flags a recent purchase and gives the first safe sale date", () => {
    const h = base("2025-08-20").harvest[0]!;
    expect(h.blockedByRecentPurchase).toBe(true);
    expect(h.earliestSafeSaleDate).toBe("2025-09-20");
  });

  it("skips positions without a price", () => {
    const r = computeTax({
      ledger: [entry({ kind: "buy", date: "2025-01-02", qty: 1, price: 10 })],
      fx: flatFx(),
      asOfDate: "2025-09-01",
    });
    expect(r.harvest).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("date math", () => {
    expect(addDays("2025-03-03", -30)).toBe("2025-02-01");
    expect(addDays("2025-03-03", 30)).toBe("2025-04-02");
    expect(isIsoDate("2025-02-30")).toBe(false);
  });

  it("registered account types", () => {
    expect(isRegistered("fhsa")).toBe(true);
    expect(isRegistered("non_registered")).toBe(false);
    expect(new D(1).toString()).toBe("1");
  });
});
