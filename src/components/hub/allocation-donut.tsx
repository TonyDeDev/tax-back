import { formatMoney, formatPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AllocationKey, AllocationSlice } from "@/server/queries/hub";

/** Each account type keeps its color whatever else is present, so a filter never repaints a slice. */
const SLICE_STYLE: Record<AllocationKey, { stroke: string; swatch: string }> = {
  non_registered: { stroke: "var(--chart-1)", swatch: "bg-chart-1" },
  tfsa: { stroke: "var(--chart-2)", swatch: "bg-chart-2" },
  rrsp: { stroke: "var(--chart-3)", swatch: "bg-chart-3" },
  other_registered: { stroke: "var(--chart-4)", swatch: "bg-chart-4" },
  cash: { stroke: "url(#allocation-hatch)", swatch: "" },
};

const SIZE = 168;
const STROKE = 22;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** The surface-colored gap between slices, in px along the ring. */
const GAP = 2;

/** Whole percents, but a sliver never reads as "0%". */
function shareText(share: string): string {
  const n = Number(share);
  return n > 0 && n < 0.005 ? "<1%" : formatPercent(n, 0);
}

interface AllocationDonutProps {
  slices: AllocationSlice[];
  totalCad: string;
}

/** Value by account type: a ring with the total in the middle and a legend that states every value. */
export function AllocationDonut({ slices, totalCad }: AllocationDonutProps) {
  const drawn = slices.filter((s) => Number(s.share) > 0);
  const gap = drawn.length > 1 ? GAP : 0;
  // Each slice starts where the ones before it end.
  const arcs = drawn.map((s, i) => ({
    slice: s,
    length: Number(s.share) * CIRCUMFERENCE,
    offset: drawn.slice(0, i).reduce((sum, x) => sum + Number(x.share) * CIRCUMFERENCE, 0),
  }));

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden className="-rotate-90">
          <defs>
            <pattern id="allocation-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--card)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-hatch)" strokeWidth="2.5" />
            </pattern>
          </defs>
          <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="var(--muted)" strokeWidth={STROKE} />
          {arcs.map(({ slice: s, length, offset }) => {
            const dash = Math.max(length - gap, 0.5);
            return (
              <circle
                key={s.key}
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke={SLICE_STYLE[s.key].stroke}
                strokeWidth={STROKE}
                strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
                strokeDashoffset={-offset}
              />
            );
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-caption text-muted-foreground">Total</span>
          <span className="font-display text-body font-semibold tabular-nums">{formatMoney(totalCad)}</span>
        </div>
      </div>

      {/* 12px only where the card is narrowest (the three-column row on a 1280px screen), so labels never truncate. */}
      <table className="w-full table-fixed text-body-sm tabular-nums xl:text-caption min-[1400px]:text-body-sm">
        <caption className="sr-only">Value by account type</caption>
        {/* A fixed layout takes its widths from here; the label column gets the rest. */}
        <colgroup>
          <col />
          <col className="w-24 xl:w-20 min-[1400px]:w-24" />
          <col className="w-11 xl:w-9 min-[1400px]:w-11" />
        </colgroup>
        <thead className="sr-only">
          <tr>
            <th scope="col">Account type</th>
            <th scope="col">Value</th>
            <th scope="col">Share</th>
          </tr>
        </thead>
        <tbody>
          {slices.map((s) => (
            <tr key={s.key} className={cn(Number(s.share) === 0 && "text-muted-foreground")}>
              <th scope="row" className="min-w-0 py-1 pr-2 text-left font-normal">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn("size-3 shrink-0 rounded-sm", SLICE_STYLE[s.key].swatch, s.key === "cash" && "border border-chart-hatch")}
                    style={
                      s.key === "cash"
                        ? { backgroundImage: "repeating-linear-gradient(45deg, var(--chart-hatch) 0 2px, transparent 2px 4px)" }
                        : undefined
                    }
                  />
                  <span className="truncate">{s.label}</span>
                </span>
              </th>
              <td className="py-1 pr-2 text-right font-mono">{formatMoney(s.valueCad)}</td>
              <td className="py-1 text-right font-mono text-muted-foreground">{shareText(s.share)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
