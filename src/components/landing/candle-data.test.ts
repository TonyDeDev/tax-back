import { describe, expect, it } from "vitest";
import { generateCandles } from "./candle-data";

describe("generateCandles", () => {
  it("is deterministic, so the hero looks the same on every load", () => {
    expect(generateCandles()).toEqual(generateCandles());
  });

  it("makes 60 columns whose wicks contain their close, inside 0..1", () => {
    const candles = generateCandles();
    expect(candles).toHaveLength(60);
    for (const c of candles) {
      expect(c.low).toBeGreaterThanOrEqual(0);
      expect(c.high).toBeLessThanOrEqual(1);
      expect(c.low).toBeLessThan(c.close);
      expect(c.close).toBeLessThan(c.high);
    }
  });

  it("trends upward from left to right", () => {
    const closes = generateCandles().map((c) => c.close);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(closes.slice(-15))).toBeGreaterThan(mean(closes.slice(0, 15)) + 0.4);
  });
});
