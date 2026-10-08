import { describe, expect, it } from "vitest";
import { returnLineConfig } from "./config/return-lines";
import { D, type Dec } from "./decimal";
import { returnLines, type ReturnLinesInput } from "./return-lines";

const ZERO_TOTALS = {
  taxableCapitalGainCad: new D(0),
  netCapitalGainCad: new D(0),
  eligibleTaxableCad: new D(0),
  nonEligibleTaxableCad: new D(0),
  foreignIncomeCad: new D(0),
  foreignWithholdingCad: new D(0),
  federalDividendCreditCad: new D(0),
};
type Totals = NonNullable<ReturnLinesInput["totals"]>;
const totals = (over: Partial<Record<keyof Totals, number>>): Totals => ({
  ...ZERO_TOTALS,
  ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, new D(v)])),
});
const gain = (date: string, proceeds: number, allowed: number) => ({ date, proceedsCad: new D(proceeds), allowedGainCad: new D(allowed) });
const byLine = (lines: { line: string | null; amountCad: Dec }[]) => Object.fromEntries(lines.map((l) => [l.line ?? "none", l.amountCad.toFixed(2)]));

describe("returnLineConfig", () => {
  it("uses lines 13199 and 13200 for every verified year but 2024", () => {
    for (const year of [2019, 2020, 2021, 2022, 2023, 2025]) {
      const c = returnLineConfig(year);
      expect(c, String(year)).toMatchObject({ verified: true, formYear: year });
      expect(c.schedule3).toEqual([{ from: `${year}-01-01`, to: `${year}-12-31`, label: null, proceedsLine: "13199", gainLine: "13200" }]);
    }
  });

  it("splits 2024 into the two periods its form asks for, covering the whole year", () => {
    const [p1, p2] = returnLineConfig(2024).schedule3;
    expect(p1).toMatchObject({ from: "2024-01-01", to: "2024-06-24", proceedsLine: "10689", gainLine: "10690" });
    expect(p2).toMatchObject({ from: "2024-06-25", to: "2024-12-31", proceedsLine: "13199", gainLine: "13200" });
  });

  it("falls back to the latest verified form for a year CRA has not published, with that year's dates", () => {
    expect(returnLineConfig(2026)).toEqual({
      year: 2026,
      formYear: 2025,
      verified: false,
      schedule3: [{ from: "2026-01-01", to: "2026-12-31", label: null, proceedsLine: "13199", gainLine: "13200" }],
    });
  });
});

describe("returnLines", () => {
  it("maps a year with a gain and every kind of dividend to its lines", () => {
    // $1,000 eligible and $200 non-eligible cash dividends, $300 foreign with $45 withheld, one sale.
    const r = returnLines({
      year: 2025,
      gains: [gain("2025-05-01", 5000, 1200)],
      totals: totals({
        taxableCapitalGainCad: 600,
        netCapitalGainCad: 1200,
        eligibleTaxableCad: 1380,
        nonEligibleTaxableCad: 230,
        foreignIncomeCad: 300,
        foreignWithholdingCad: 45,
        federalDividendCreditCad: 228.04,
      }),
    });
    expect(byLine(r.lines)).toEqual({
      "13199": "5000.00",
      "13200": "1200.00",
      "12700": "600.00",
      "12000": "1610.00",
      "12010": "230.00",
      "12100": "300.00",
      "40425": "228.04",
      none: "45.00",
    });
    expect(r.netCapitalLossCad).toBeNull();
  });

  it("sums 2024 dispositions into the period of their settlement date", () => {
    const r = returnLines({
      year: 2024,
      gains: [gain("2024-03-01", 1000, 100), gain("2024-06-24", 500, -50), gain("2024-06-25", 2000, 300)],
      totals: totals({ taxableCapitalGainCad: 175, netCapitalGainCad: 350 }),
    });
    expect(byLine(r.lines)).toMatchObject({ "10689": "1500.00", "10690": "50.00", "13199": "2000.00", "13200": "300.00", "12700": "175.00" });
  });

  it("puts zero on line 12700 for a net loss and reports the loss to carry", () => {
    const r = returnLines({
      year: 2025,
      gains: [gain("2025-02-01", 800, -400)],
      totals: totals({ taxableCapitalGainCad: -200, netCapitalGainCad: -400 }),
    });
    expect(byLine(r.lines)["12700"]).toBe("0.00");
    expect(r.netCapitalLossCad!.toFixed(2)).toBe("400.00");
  });

  it("leaves out empty lines but always shows line 12700, even with no results", () => {
    const r = returnLines({ year: 2025, gains: [], totals: null });
    expect(r.lines.map((l) => l.line)).toEqual(["12700"]);
    expect(r.lines[0]!.amountCad.toFixed(2)).toBe("0.00");
  });
});
