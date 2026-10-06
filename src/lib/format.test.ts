import { describe, expect, it } from "vitest";
import {
  directionOf,
  formatAgo,
  formatCompactMoney,
  formatDate,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatShortDate,
} from "./format";

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
    expect(formatShortDate("2025-03-03")).toBe("Mar 3");
    expect(formatShortDate("2025-03-03", true)).toBe("Mar 3, 2025");
  });

  it("formats compact axis money", () => {
    expect(formatCompactMoney(43300.6)).toBe("$43.3K");
    expect(formatCompactMoney(1_250_000)).toBe("$1.3M");
  });

  it("classifies direction", () => {
    expect(directionOf(5)).toBe("gain");
    expect(directionOf("-5")).toBe("loss");
    expect(directionOf(0)).toBe("flat");
  });
});

describe("formatAgo", () => {
  const now = new Date("2026-10-06T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);

  it("rounds down to the largest whole unit", () => {
    expect(formatAgo(ago(20_000), now)).toBe("just now");
    expect(formatAgo(ago(5 * 60_000), now)).toBe("5 min ago");
    expect(formatAgo(ago(3 * 3_600_000 + 59 * 60_000), now)).toBe("3 h ago");
    expect(formatAgo(ago(24 * 3_600_000), now)).toBe("1 day ago");
    expect(formatAgo(ago(50 * 3_600_000), now)).toBe("2 days ago");
  });
});
