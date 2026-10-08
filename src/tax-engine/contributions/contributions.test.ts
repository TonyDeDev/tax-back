import { describe, expect, it } from "vitest";
import { rrspDeadline, rrspScheduleYear, tfsaLimit } from "../config/contribution-limits";
import { schedule15Config, schedule7Config } from "../config/contribution-forms";
import { D, type Dec } from "../decimal";
import { flatFx } from "../test-helpers";
import { classifyFlows } from "./classify";
import { monthlyExcess } from "./excess";
import { computeContributions, contributionLines } from "./index";
import type {
  CashFlow,
  ContributionProfile,
  ContributionYearInput,
  ContributionsInput,
  FhsaYear,
  FlowClassification,
  RrspYear,
  TfsaYear,
} from "./types";

let n = 0;
interface FlowInit {
  date: string;
  amount: number | string;
  plan?: CashFlow["plan"];
  account?: string | null;
  dir?: "in" | "out";
  type?: string | null;
  cls?: FlowClassification;
  currency?: string;
  investment?: boolean;
}
function flow(init: FlowInit): CashFlow {
  n += 1;
  const dir = init.dir ?? "in";
  return {
    id: `f${n}`,
    accountId: init.account === undefined ? `acct-${init.plan ?? "tfsa"}` : init.account,
    plan: init.plan ?? "tfsa",
    investment: init.investment ?? true,
    date: init.date,
    direction: dir,
    amount: new D(init.amount),
    currency: init.currency ?? "CAD",
    brokerType: init.type === undefined ? (dir === "in" ? "CONTRIBUTION" : "WITHDRAWAL") : init.type,
    classification: init.cls ?? null,
  };
}

function yearInput(init: Partial<Omit<ContributionYearInput, "plan" | "year">> & Pick<ContributionYearInput, "plan" | "year">): ContributionYearInput {
  return {
    officialRoom: null,
    unusedCarriedForward: null,
    earnedIncomePriorYear: null,
    pensionAdjustment: null,
    deductionClaimed: null,
    ...init,
  };
}

const NO_PROFILE: ContributionProfile = { birthYear: null, residentSinceYear: null, fhsaOpenedYear: null };

function run(over: Partial<ContributionsInput>) {
  return computeContributions({
    flows: [],
    inputs: [],
    profile: NO_PROFILE,
    fx: flatFx("1.35"),
    asOfDate: "2025-12-31",
    plansHeld: [],
    historyFrom: {},
    ...over,
  });
}

const money = (v: Dec | null | undefined) => (v === null || v === undefined ? null : v.toFixed(2));
const tfsa = (r: ReturnType<typeof run>, year: number) => r.years.find((y): y is TfsaYear => y.plan === "tfsa" && y.year === year)!;
const rrsp = (r: ReturnType<typeof run>, year: number) => r.years.find((y): y is RrspYear => y.plan === "rrsp" && y.year === year)!;
const fhsa = (r: ReturnType<typeof run>, year: number) => r.years.find((y): y is FhsaYear => y.plan === "fhsa" && y.year === year)!;

describe("contribution limits", () => {
  it("has CRA's TFSA dollar limits, nothing before 2009", () => {
    expect(tfsaLimit(2008).amount.toNumber()).toBe(0);
    expect(tfsaLimit(2015).amount.toNumber()).toBe(10000);
    expect(tfsaLimit(2023).amount.toNumber()).toBe(6500);
    expect(tfsaLimit(2026)).toMatchObject({ assumed: false });
    expect(tfsaLimit(2027)).toMatchObject({ assumed: true });
    // Cumulative room for someone 18 or older in 2009 who never contributed: CRA says $109,000 in 2026.
    let total = new D(0);
    for (let y = 2009; y <= 2026; y += 1) total = total.plus(tfsaLimit(y).amount);
    expect(total.toNumber()).toBe(109000);
  });

  it("puts the RRSP deadline on the 60th day of the next year, moved off a weekend, as Schedule 7 does", () => {
    expect(rrspDeadline(2019)).toBe("2020-03-02");
    expect(rrspDeadline(2020)).toBe("2021-03-01");
    expect(rrspDeadline(2021)).toBe("2022-03-01");
    expect(rrspDeadline(2022)).toBe("2023-03-01");
    expect(rrspDeadline(2023)).toBe("2024-02-29");
    expect(rrspDeadline(2024)).toBe("2025-03-03");
    expect(rrspDeadline(2025)).toBe("2026-03-02");
  });

  it("assigns a first-60-days contribution to the year before", () => {
    expect(rrspScheduleYear("2026-03-02")).toBe(2025);
    expect(rrspScheduleYear("2026-03-03")).toBe(2026);
    expect(rrspScheduleYear("2025-03-03")).toBe(2024);
    expect(rrspScheduleYear("2025-03-04")).toBe(2025);
  });

  it("uses each year's Schedule 7 and Schedule 15 line numbers", () => {
    expect(schedule7Config(2020).lines).toMatchObject({ deduction: "17", carryForward: "18" });
    expect(schedule7Config(2025).lines).toMatchObject({ deduction: "20", carryForward: "23" });
    expect(schedule7Config(2026)).toMatchObject({ formYear: 2025, verified: false });
    expect(schedule15Config(2023).lines).toMatchObject({ annualLimit: "11", deduction: "20" });
    expect(schedule15Config(2024).lines).toMatchObject({ annualLimit: "33", deduction: "50" });
    expect(schedule15Config(2025).lines).toMatchObject({ annualLimit: "40", deduction: "57" });
  });
});

describe("monthlyExcess", () => {
  it("taxes each month's highest excess at 1%, and only months that have happened", () => {
    // $3,000 excess from March 10, withdrawn on May 20: March, April, and May are taxed at $3,000.
    const points = [
      { date: "2025-03-10", excessCad: new D(3000) },
      { date: "2025-05-20", excessCad: new D(0) },
    ];
    expect(money(monthlyExcess(2025, new D(0), points, "2025-12-31").penaltyCad)).toBe("90.00");
    expect(money(monthlyExcess(2025, new D(0), points, "2025-04-15").penaltyCad)).toBe("60.00");
    expect(money(monthlyExcess(2026, new D(0), points, "2025-04-15").penaltyCad)).toBe("0.00");
  });
});

describe("classifyFlows", () => {
  const fx = flatFx("1.35");

  it("reads deposits into a registered account as contributions and converts USD at the day's rate", () => {
    const [c, w, usd] = classifyFlows(
      [
        flow({ date: "2025-02-01", amount: 1000 }),
        flow({ date: "2025-03-01", amount: 200, dir: "out" }),
        flow({ date: "2025-04-01", amount: 100, plan: "us_retirement", currency: "USD" }),
      ],
      fx,
    );
    expect(c).toMatchObject({ kind: "contribution", plan: "tfsa", taxYear: 2025, fxRate: null, needsReview: false });
    expect(w).toMatchObject({ kind: "withdrawal", plan: "tfsa" });
    expect(usd).toMatchObject({ kind: "contribution", plan: "us_retirement" });
    expect(money(usd!.amountCad)).toBe("135.00");
    expect(usd!.fxRate?.toString()).toBe("1.35");
  });

  it("ignores non-registered and cash accounts", () => {
    const [nonReg, cash] = classifyFlows(
      [flow({ date: "2025-02-01", amount: 1000, plan: "non_registered" }), flow({ date: "2025-02-01", amount: 1000, investment: false })],
      fx,
    );
    expect(nonReg).toMatchObject({ kind: "ignored", plan: null });
    expect(cash).toMatchObject({ kind: "ignored", plan: null });
  });

  it("pairs an internal transfer between two TFSAs as a transfer, and one from a non-registered account as a contribution", () => {
    const flows = [
      flow({ date: "2025-06-02", amount: 500, account: "tfsa-a", dir: "out", type: "INTERNAL_CASH_TRANSFER_OUT" }),
      flow({ date: "2025-06-03", amount: 500, account: "tfsa-b", dir: "in", type: "INTERNAL_CASH_TRANSFER_IN" }),
      flow({ date: "2025-07-01", amount: 800, account: "margin", plan: "non_registered", dir: "out", type: "INTERNAL_CASH_TRANSFER_OUT" }),
      flow({ date: "2025-07-01", amount: 800, account: "tfsa-a", dir: "in", type: "INTERNAL_CASH_TRANSFER_IN" }),
      flow({ date: "2025-08-01", amount: 50, account: "tfsa-a", dir: "in", type: "INTERNAL_CASH_TRANSFER_IN" }),
    ];
    const [out, inn, marginOut, fromMargin, unpaired] = classifyFlows(flows, fx);
    expect(out).toMatchObject({ kind: "transfer", needsReview: false });
    expect(inn).toMatchObject({ kind: "transfer", needsReview: false });
    expect(marginOut).toMatchObject({ kind: "ignored" });
    expect(fromMargin).toMatchObject({ kind: "contribution", needsReview: false });
    expect(unpaired).toMatchObject({ kind: "contribution", needsReview: true });
  });

  it("reads cash moved from an RRSP to an FHSA as an RRSP-to-FHSA transfer", () => {
    const [out, inn] = classifyFlows(
      [
        flow({ date: "2025-06-02", amount: 4000, plan: "rrsp", dir: "out", type: "INTERNAL_CASH_TRANSFER_OUT" }),
        flow({ date: "2025-06-02", amount: 4000, plan: "fhsa", dir: "in", type: "INTERNAL_CASH_TRANSFER_IN" }),
      ],
      fx,
    );
    expect(out).toMatchObject({ kind: "transfer" });
    expect(inn).toMatchObject({ kind: "rrsp_to_fhsa" });
  });

  it("lets the user's classification win", () => {
    const [a, b] = classifyFlows(
      [
        flow({ date: "2025-02-01", amount: 1000, cls: "transfer" }),
        flow({ date: "2025-02-01", amount: 1000, type: "INTERNAL_CASH_TRANSFER_IN", cls: "contribution" }),
      ],
      fx,
    );
    expect(a).toMatchObject({ kind: "transfer", needsReview: false });
    expect(b).toMatchObject({ kind: "contribution", needsReview: false });
  });

  it("files an RRSP contribution in the first 60 days under the year before", () => {
    const [jan, march] = classifyFlows(
      [flow({ date: "2026-02-15", amount: 1000, plan: "rrsp" }), flow({ date: "2026-03-10", amount: 1000, plan: "rrsp" })],
      fx,
    );
    expect(jan!.taxYear).toBe(2025);
    expect(march!.taxYear).toBe(2026);
  });
});

describe("TFSA room", () => {
  it("estimates room from the year the holder turned 18, and restores a withdrawal only the next January", () => {
    // Born 2005: room starts in 2023 ($6,500), then 2024 ($7,000) and 2025 ($7,000).
    // 2024: contributes $13,500 (all room), withdraws $3,000. 2025 room = 0 + 3,000 + 7,000 = $10,000.
    const r = run({
      profile: { ...NO_PROFILE, birthYear: 2005 },
      historyFrom: { tfsa: "2023-01-01" },
      flows: [flow({ date: "2024-02-01", amount: 13500 }), flow({ date: "2024-09-01", amount: 3000, dir: "out" })],
    });
    const y2024 = tfsa(r, 2024);
    expect(y2024).toMatchObject({ roomSource: "estimate", estimateIncomplete: false });
    expect(money(y2024.openingRoomCad)).toBe("13500.00");
    expect(money(y2024.roomRemainingCad)).toBe("0.00");
    expect(money(y2024.restoredNextYearCad)).toBe("3000.00");
    expect(money(tfsa(r, 2025).openingRoomCad)).toBe("10000.00");
    expect(money(y2024.penaltyCad)).toBe("0.00");
  });

  it("taxes a same-year recontribution of a withdrawal as an excess", () => {
    // CRA's classic mistake: $7,000 room on January 1, contribute $7,000 in January, withdraw $5,000 in
    // March, put it back in July. The $5,000 is an excess from July to December: 6 months x 1% = $300.
    const r = run({
      inputs: [yearInput({ plan: "tfsa", year: 2025, officialRoom: new D(7000) })],
      flows: [
        flow({ date: "2025-01-10", amount: 7000 }),
        flow({ date: "2025-03-10", amount: 5000, dir: "out" }),
        flow({ date: "2025-07-10", amount: 5000 }),
      ],
    });
    const y = tfsa(r, 2025);
    expect(y.roomSource).toBe("cra");
    expect(money(y.roomRemainingCad)).toBe("-5000.00");
    expect(money(y.peakExcessCad)).toBe("5000.00");
    expect(money(y.penaltyCad)).toBe("300.00");
  });

  it("does not restore the part of a withdrawal that removed an excess", () => {
    // $1,000 over in May, $1,500 withdrawn in June: $1,000 removes the excess, only $500 comes back.
    const r = run({
      asOfDate: "2026-06-30",
      inputs: [yearInput({ plan: "tfsa", year: 2025, officialRoom: new D(7000) })],
      flows: [flow({ date: "2025-05-01", amount: 8000 }), flow({ date: "2025-06-15", amount: 1500, dir: "out" })],
    });
    const y = tfsa(r, 2025);
    expect(money(y.penaltyCad)).toBe("20.00");
    expect(money(y.restoredNextYearCad)).toBe("500.00");
    expect(money(tfsa(r, 2026).openingRoomCad)).toBe("7500.00");
  });

  it("flags an estimate that starts before the tracked history, and says unknown without a birth year", () => {
    const flows = [flow({ date: "2025-01-10", amount: 1000 })];
    const estimate = run({ profile: { ...NO_PROFILE, birthYear: 1980 }, historyFrom: { tfsa: "2021-05-01" }, flows });
    expect(tfsa(estimate, 2025)).toMatchObject({ roomSource: "estimate", estimateIncomplete: true });
    expect(money(tfsa(estimate, 2025).openingRoomCad)).toBe("102000.00");
    const unknown = run({ flows });
    expect(tfsa(unknown, 2025)).toMatchObject({ roomSource: "unknown", openingRoomCad: null, roomRemainingCad: null });
  });
});

describe("RRSP and Schedule 7", () => {
  it("splits contributions into the two Schedule 7 periods and deducts up to the limit", () => {
    // 2025 limit $10,000 (CRA). $4,000 in June 2025, $8,000 in February 2026 (counts for 2025).
    // Available $12,000, deduction $10,000, $2,000 carried to 2026.
    const r = run({
      asOfDate: "2026-04-01",
      inputs: [yearInput({ plan: "rrsp", year: 2025, officialRoom: new D(10000) })],
      flows: [flow({ date: "2025-06-01", amount: 4000, plan: "rrsp" }), flow({ date: "2026-02-15", amount: 8000, plan: "rrsp" })],
    });
    const y = rrsp(r, 2025);
    expect(y).toMatchObject({ roomSource: "cra", deadline: "2026-03-02" });
    expect(money(y.periodOneCad)).toBe("4000.00");
    expect(money(y.periodTwoCad)).toBe("8000.00");
    expect(money(y.deductionCad)).toBe("10000.00");
    expect(money(y.carryForwardCad)).toBe("2000.00");
    expect(money(y.unusedRoomCad)).toBe("0.00");
    expect(money(rrsp(r, 2026).unusedFromPriorCad)).toBe("2000.00");
  });

  it("lets the user defer a deduction, carrying both the contribution and the room", () => {
    const r = run({
      asOfDate: "2026-12-31",
      inputs: [
        yearInput({ plan: "rrsp", year: 2025, officialRoom: new D(20000), deductionClaimed: new D(3000) }),
        yearInput({ plan: "rrsp", year: 2026, earnedIncomePriorYear: new D(100000), pensionAdjustment: new D(2500) }),
      ],
      flows: [flow({ date: "2025-06-01", amount: 10000, plan: "rrsp" })],
    });
    expect(money(rrsp(r, 2025).deductionCad)).toBe("3000.00");
    expect(money(rrsp(r, 2025).carryForwardCad)).toBe("7000.00");
    // 2026 limit: unused room 17,000 + min(18% x 100,000, 33,810) - PA 2,500 = 32,500.
    const y2026 = rrsp(r, 2026);
    expect(y2026.roomSource).toBe("estimate");
    expect(money(y2026.deductionLimitCad)).toBe("32500.00");
    expect(money(y2026.deductionCad)).toBe("7000.00");
  });

  it("leaves the limit unknown without a CRA figure or an earlier year to build on", () => {
    const r = run({
      inputs: [yearInput({ plan: "rrsp", year: 2025, earnedIncomePriorYear: new D(80000) })],
      flows: [flow({ date: "2025-06-01", amount: 5000, plan: "rrsp" })],
    });
    expect(rrsp(r, 2025)).toMatchObject({ roomSource: "unknown", deductionLimitCad: null, deductionCad: null, carryForwardCad: null });
  });

  it("taxes undeducted contributions above the limit plus the $2,000 buffer", () => {
    // Limit $5,000; $10,000 contributed on April 2: $3,000 over the buffer for April to December = 9 x $30.
    const r = run({
      inputs: [yearInput({ plan: "rrsp", year: 2025, officialRoom: new D(5000) })],
      flows: [flow({ date: "2025-04-02", amount: 10000, plan: "rrsp" })],
    });
    expect(money(rrsp(r, 2025).peakExcessCad)).toBe("3000.00");
    expect(money(rrsp(r, 2025).penaltyCad)).toBe("270.00");
  });
});

describe("FHSA and Schedule 15", () => {
  it("carries unused participation room forward, at most $8,000", () => {
    // Opened 2023 with $2,000; 2024 room = 8,000 + 6,000 = $14,000; contributes $14,000.
    const r = run({
      flows: [flow({ date: "2023-05-01", amount: 2000, plan: "fhsa" }), flow({ date: "2024-05-01", amount: 14000, plan: "fhsa" })],
    });
    expect(fhsa(r, 2023)).toMatchObject({ firstYear: true, roomSource: "estimate" });
    expect(money(fhsa(r, 2023).annualLimitCad)).toBe("2000.00");
    const y2024 = fhsa(r, 2024);
    expect(money(y2024.carryforwardInCad)).toBe("6000.00");
    expect(money(y2024.participationRoomCad)).toBe("14000.00");
    expect(money(y2024.annualLimitCad)).toBe("14000.00");
    expect(money(y2024.deductionCad)).toBe("14000.00");
    expect(money(y2024.penaltyCad)).toBe("0.00");
    // Nothing in 2025: carryforward from 2024 is 0, so room is $8,000.
    expect(money(fhsa(r, 2025).participationRoomCad)).toBe("8000.00");
    expect(money(fhsa(r, 2025).lifetimeUsedCad)).toBe("16000.00");
  });

  it("counts an RRSP transfer against room but not as a deduction", () => {
    // 2025: $5,000 from the RRSP, $3,000 contributed, room $8,000: annual limit 3,000, deduction 3,000.
    const r = run({
      profile: { ...NO_PROFILE, fhsaOpenedYear: 2025 },
      flows: [
        flow({ date: "2025-02-01", amount: 5000, plan: "fhsa", cls: "rrsp_to_fhsa" }),
        flow({ date: "2025-03-01", amount: 3000, plan: "fhsa" }),
      ],
    });
    const y = fhsa(r, 2025);
    expect(money(y.rrspTransfersCad)).toBe("5000.00");
    expect(money(y.annualLimitCad)).toBe("3000.00");
    expect(money(y.deductionCad)).toBe("3000.00");
    expect(money(y.roomRemainingCad)).toBe("0.00");
  });

  it("taxes an excess, carries it into next year's limit, and lets the deduction be deferred", () => {
    // 2024 opened, $9,000 in June: $1,000 over for June to December = 7 x $10. Defer: deduct $2,000.
    const r = run({
      inputs: [yearInput({ plan: "fhsa", year: 2024, deductionClaimed: new D(2000) })],
      flows: [flow({ date: "2024-06-01", amount: 9000, plan: "fhsa" })],
    });
    const y2024 = fhsa(r, 2024);
    expect(money(y2024.annualLimitCad)).toBe("8000.00");
    expect(money(y2024.penaltyCad)).toBe("70.00");
    expect(money(y2024.deductionCad)).toBe("2000.00");
    expect(money(y2024.carryForwardCad)).toBe("7000.00");
    // 2025: the $1,000 excess is absorbed by the new $8,000 room, and the limit to date (16,000) less
    // past deductions (2,000) lets the full $8,000 left of contributions be deducted.
    const y2025 = fhsa(r, 2025);
    expect(money(y2025.annualLimitCad)).toBe("1000.00");
    expect(money(y2025.penaltyCad)).toBe("0.00");
    expect(money(y2025.maxDeductionCad)).toBe("7000.00");
    expect(money(y2025.deductionCad)).toBe("7000.00");
    expect(money(y2025.carryForwardCad)).toBe("0.00");
  });
});

describe("other plans", () => {
  it("lists contributions and withdrawals for plans without room tracking", () => {
    const r = run({
      flows: [flow({ date: "2025-01-10", amount: 2500, plan: "resp" }), flow({ date: "2025-06-10", amount: 300, plan: "rrif", dir: "out" })],
    });
    expect(r.years.find((y) => y.plan === "resp")).toMatchObject({ year: 2025 });
    expect(money(r.years.find((y) => y.plan === "rrif")!.withdrawalsCad)).toBe("300.00");
  });

  it("gives a held plan with no activity this year's room", () => {
    const r = run({ plansHeld: ["tfsa"], profile: { ...NO_PROFILE, birthYear: 1990 } });
    expect(r.years.map((y) => `${y.plan}:${y.year}`)).toEqual(["tfsa:2025"]);
  });
});

describe("contributionLines", () => {
  it("lays out Schedule 7 with the 2025 periods and the T1 deduction line", () => {
    const r = run({
      asOfDate: "2026-04-01",
      inputs: [yearInput({ plan: "rrsp", year: 2025, officialRoom: new D(10000), unusedCarriedForward: new D(500) })],
      flows: [flow({ date: "2025-06-01", amount: 4000, plan: "rrsp" })],
    });
    const { lines, forms } = contributionLines({ year: 2025, rrsp: rrsp(r, 2025), fhsa: null });
    expect(forms).toEqual([{ form: "Schedule 7", formYear: 2025, verified: true }]);
    const byLine = Object.fromEntries(lines.map((l) => [`${l.form} ${l.line}`, money(l.amountCad)]));
    expect(byLine).toEqual({
      "Schedule 7 1": "500.00",
      "Schedule 7 2": "4000.00",
      "Schedule 7 3": "0.00",
      "Schedule 7 4": "4000.00",
      "Schedule 7 11": "10000.00",
      "Schedule 7 20": "4500.00",
      "Schedule 7 23": "0.00",
      "T1 20800": "4500.00",
    });
    expect(lines.find((l) => l.key === "s7-period-one")!.label).toBe("RRSP contributions from March 4, 2025 to December 31, 2025");
    expect(lines.find((l) => l.key === "s7-period-two")!.label).toBe("RRSP contributions from January 1 to March 2, 2026");
  });

  it("leaves out the deduction when the limit is unknown", () => {
    const r = run({ flows: [flow({ date: "2025-06-01", amount: 4000, plan: "rrsp" })] });
    const keys = contributionLines({ year: 2025, rrsp: rrsp(r, 2025), fhsa: null }).lines.map((l) => l.key);
    expect(keys).not.toContain("t1-20800");
  });

  it("lays out Schedule 15 for a first year with the opening box noted", () => {
    const r = run({ flows: [flow({ date: "2025-05-01", amount: 6000, plan: "fhsa" })] });
    const { lines } = contributionLines({ year: 2025, rrsp: null, fhsa: fhsa(r, 2025) });
    const byLine = Object.fromEntries(lines.map((l) => [`${l.form} ${l.line}`, money(l.amountCad)]));
    expect(byLine).toEqual({
      "Schedule 15 1": "6000.00",
      "Schedule 15 40": "6000.00",
      "Schedule 15 51": "6000.00",
      "Schedule 15 57": "6000.00",
      "Schedule 15 58": "0.00",
      "T1 20805": "6000.00",
    });
    expect(lines[0]!.note).toContain("68930");
  });
});
