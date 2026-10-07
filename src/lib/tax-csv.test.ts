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
});

describe("taxYearCsvFilename", () => {
  it("names the download after the year", () => {
    expect(taxYearCsvFilename(2025)).toBe("taxback-2025.csv");
  });
});
