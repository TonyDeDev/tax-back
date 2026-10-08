/** One column of the landing candle field, in 0..1 chart units (0 at the bottom). */
export interface Candle {
  low: number;
  high: number;
  close: number;
}

/** mulberry32: a small seeded PRNG, so the field is identical on every load and in every test. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A deterministic random walk with an upward drift, scaled to fill 0..1: each close moves from the
 * last, and each wick reaches past both the open and the close. Decoration only, not market data.
 */
export function generateCandles(count = 60, seed = 20_26): Candle[] {
  const random = mulberry32(seed);
  const raw: Candle[] = [];
  let close = 0;
  for (let i = 0; i < count; i++) {
    const open = close;
    close = open + 0.6 + (random() - 0.44) * 4;
    const body = Math.abs(close - open);
    raw.push({
      low: Math.min(open, close) - (4 + random() * 12) - body * 0.3,
      high: Math.max(open, close) + (4 + random() * 12) + body * 0.3,
      close,
    });
  }
  const min = Math.min(...raw.map((c) => c.low));
  const max = Math.max(...raw.map((c) => c.high));
  const scale = (v: number) => (v - min) / (max - min);
  return raw.map((c) => ({ low: scale(c.low), high: scale(c.high), close: scale(c.close) }));
}
