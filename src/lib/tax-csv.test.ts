import { describe, expect, it } from "vitest";
import type { TaxYearView } from "@/server/queries/tax";
import { taxYearCsv, taxYearCsvFilename, toCsv } from "./tax-csv";

/* The CSV writer on its own: quoting, number formatting, and the sections of a year with nothing in it. */

const EMPTY: TaxYearView = {
  year: 2025,
  isCurrentYear: false,
  totals: null,
  gains: [],
  superficialLosses: [],
  dividends: [],
  harvest: [],
  marginalRate: null,
  returnView: { formYear: 2025, verified: true, lines: [], netCapitalLossCad: null, capitalLossCad: null, checks: [], t3Symbols: [], contributionForms: [], tfsa: null },
};

describe("toCsv", () => {
  it("leaves a plain cell alone and ends every file with a newline", () => {
    expect(toCsv([["a", "b"], ["1", "2"]])).toBe("a,b\r\n1,2\r\n");
  });

  it("quotes a cell holding a comma, a quote, or a newline, and doubles its quotes", () => {
    expect(toCsv([["Bank, of Montreal", 'He said "sell"', "two\nlines"]])).toBe(
      '"Bank, of Montreal","He said ""sell""","two\nlines"\r\n',
    );
  });

  it("quotes a cell with edge whitespace, so a reader cannot trim it away", () => {
    expect(toCsv([[" padded "]])).toBe('" padded "\r\n');
  });

  it("defuses a cell a spreadsheet would run as a formula, but keeps signed numbers as numbers", () => {
    expect(toCsv([["=HYPERLINK(\"x\")", "@SUM(A1)", "+1+1", "-cmd", "-12.34", "+5", "-0.5%"]])).toBe(
      `"'=HYPERLINK(""x"")",'@SUM(A1),'+1+1,'-cmd,-12.34,+5,-0.5%\r\n`,
    );
  });

  it("writes an empty cell for null and undefined, and yes or no for a flag", () => {
    expect(toCsv([[null, undefined, true, false, 0]])).toBe(",,yes,no,0\r\n");
  });
});

describe("taxYearCsv", () => {
  it("heads the file with the year, the date, and the not-tax-advice note", () => {
    const csv = taxYearCsv(EMPTY, "2026-10-06");
    expect(csv.startsWith("TaxBack,Tax year 2025\r\nGenerated,2026-10-06\r\n")).toBe(true);
    expect(csv).toContain("not tax advice");
  });

  it("says so in every section when the year has no results", () => {
    const csv = taxYearCsv(EMPTY, "2026-10-06");
    expect(csv).toContain("Summary\r\nNo tax results for this year.");
    expect(csv).toContain("Realized gains and losses (Schedule 3)\r\nNone for this year.");
    expect(csv).toContain("Superficial losses\r\nNone for this year.");
    expect(csv).toContain("Dividends and investment income\r\nNone for this year.");
    // Harvesting is live data, not a line of the year, so it is left out rather than named empty.
    expect(csv).not.toContain("Tax-loss harvesting");
  });

  it("writes money to two decimals and trims the padding off a quantity", () => {
    const csv = taxYearCsv(
      {
        ...EMPTY,
        gains: [
          {
            id: "g1",
            securityId: "sec1",
            symbol: "XEQT",
            name: "iShares Core Equity ETF, All-in-One",
            accountName: "Margin",
            kind: "sale",
            dispositionDate: "2025-07-02",
            quantity: "12.5000000000",
            proceedsCad: "1234.567800",
            acbCad: "1000.000000",
            feesCad: "4.950000",
            gainCad: "229.617800",
            deniedLossCad: "0.000000",
            allowedGainCad: "229.617800",
            incomplete: false,
          },
        ],
      },
      "2026-10-06",
    );
    // The name holds a comma, so the cell is quoted; proceeds round half up to the cent.
    expect(csv).toContain('2025-07-02,"XEQT - iShares Core Equity ETF, All-in-One",Margin,Sale,12.5,1234.57,1000.00,4.95,229.62,0.00,229.62,no');
  });

  it("spells out an unset marginal rate instead of printing a zero", () => {
    const csv = taxYearCsv(
      {
        ...EMPTY,
        totals: {
          proceedsCad: "0",
          acbCad: "0",
          feesCad: "0",
          grossGainCad: "0",
          netCapitalGainCad: "0",
          deniedLossesCad: "0",
          inclusionRate: "0.50000",
          taxableCapitalGainCad: "0",
          eligibleDividendsCad: "0",
          nonEligibleDividendsCad: "0",
          eligibleTaxableCad: "0",
          nonEligibleTaxableCad: "0",
          foreignIncomeCad: "0",
          foreignWithholdingCad: "0",
          federalDividendCreditCad: "0",
          totalIncomeCad: "0",
          estimatedTaxCad: null,
          configAssumed: false,
        },
      },
      "2026-10-06",
    );
    expect(csv).toContain("Estimated tax on capital gains,not estimated (no marginal rate set)");
    expect(csv).toContain("Inclusion rate,50%");
  });

  it("opens with the lines to enter, the checks to make first, and flags line numbers from an earlier form", () => {
    const csv = taxYearCsv(
      {
        ...EMPTY,
        year: 2026,
        returnView: {
          formYear: 2025,
          verified: false,
          lines: [{ key: "t1-12700", form: "T1", line: "12700", label: "Taxable capital gains", amountCad: "114.81", note: null }],
          netCapitalLossCad: null,
          capitalLossCad: null,
          checks: [{ key: "gap-x", text: "VFV: your brokers hold more units than the history explains, so its ACB may be wrong.", href: null, linkLabel: null }],
          t3Symbols: [],
          contributionForms: [],
          tfsa: null,
        },
      },
      "2026-10-07",
    );
    expect(csv).toContain("For your return\r\nLine numbers are from the 2025 forms; check them once CRA publishes the 2026 forms.\r\n");
    expect(csv).toContain("T1,12700,Taxable capital gains,114.81,\r\n");
    // The check holds a comma, so its cell is quoted.
    expect(csv).toContain('Check first\r\n"VFV: your brokers hold more units than the history explains, so its ACB may be wrong."\r\n');
    expect(csv.indexOf("\r\nFor your return\r\n")).toBeLessThan(csv.indexOf("\r\nSummary\r\n"));
  });

  it("lists the Schedule 7 lines, flags an unpublished schedule, and adds the TFSA room check", () => {
    const csv = taxYearCsv(
      {
        ...EMPTY,
        year: 2026,
        returnView: {
          ...EMPTY.returnView,
          lines: [{ key: "t1-20800", form: "T1", line: "20800", label: "RRSP deduction", amountCad: "4500.00", note: "From Schedule 7." }],
          contributionForms: [{ form: "Schedule 7", formYear: 2025, verified: false }],
          tfsa: { roomSource: "estimate", roomRemainingCad: "-500.000000", peakExcessCad: "500.000000", penaltyCad: "10.000000", estimateIncomplete: false },
        },
      },
      "2026-10-07",
    );
    expect(csv).toContain("Schedule 7 line numbers are from the 2025 form; check them once CRA publishes the 2026 form.\r\n");
    expect(csv).toContain("T1,20800,RRSP deduction,4500.00,From Schedule 7.\r\n");
    expect(csv).toContain("TFSA,,TFSA room left (no form to file),-500.00,Over the limit: estimated tax of 10.00 at 1% a month (Form RC243).\r\n");
  });
});

describe("taxYearCsvFilename", () => {
  it("names the download after the year", () => {
    expect(taxYearCsvFilename(2025)).toBe("taxback-2025.csv");
  });
});
