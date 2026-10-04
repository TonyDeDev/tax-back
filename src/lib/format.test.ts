import { describe, expect, it } from "vitest";
import { directionOf, formatDate, formatMoney, formatPercent, formatQuantity } from "./format";

describe("format", () => {
  it("formats CAD money and signs on request", () => {
    expect(formatMoney(1234.5)).toMatch(/1,234\.50/);
    expect(formatMoney("100", "CAD", { signed: true })).toContain("+");
    expect(formatMoney(-100, "CAD", { signed: true })).toMatch(/^[-−]/);
    expect(formatMoney(0, "CAD", { signed: true })).not.toMatch(/[+\-−]/);
  });

  it("formats quantity, percent, and dates", () => {
    expect(formatQuantity("1000.123456")).toBe("1,000.1235");
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatDate("2025-03-03")).toBe("Mar 3, 2025");
  });

  it("classifies direction", () => {
    expect(directionOf(5)).toBe("gain");
    expect(directionOf("-5")).toBe("loss");
    expect(directionOf(0)).toBe("flat");
  });
});
