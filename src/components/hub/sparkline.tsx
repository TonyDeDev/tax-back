interface SparklineProps {
  /** Prices oldest first, as saved decimal strings. */
  values: string[];
  label: string;
  width?: number;
  height?: number;
}

/** A tiny price trend. Neutral ink: direction is told by the Unrealized column, not by color here. */
export function Sparkline({ values, label, width = 72, height = 24 }: SparklineProps) {
  if (values.length < 2) return <span className="text-muted-foreground">-</span>;
  const numbers = values.map(Number);
  const min = Math.min(...numbers);
  const max = Math.max(...numbers);
  const span = max - min || 1;
  const step = width / (numbers.length - 1);
  const points = numbers.map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`).join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="text-muted-foreground">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
