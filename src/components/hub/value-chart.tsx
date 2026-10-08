"use client";

import { LineChart as LineChartIcon } from "lucide-react";
import { useId, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useAmountsHidden } from "@/components/amounts";
import { formatCompactMoney, formatMoney, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface ChartPoint {
  day: string;
  /** Saved CAD total as a decimal string; converted to a number for plotting only. */
  valueCad: string;
}

const RANGES = ["1W", "1M", "3M", "YTD", "1Y", "All"] as const;
type Range = (typeof RANGES)[number];

const RANGE_LABELS: Record<Range, string> = {
  "1W": "Past week",
  "1M": "Past month",
  "3M": "Past 3 months",
  YTD: "Year to date",
  "1Y": "Past year",
  All: "All history",
};

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first day each range covers, relative to `today` (Toronto, from the server). */
function rangeStart(range: Range, today: string): string | null {
  switch (range) {
    case "1W":
      return shift(today, -7);
    case "1M":
      return shift(today, -30);
    case "3M":
      return shift(today, -91);
    case "YTD":
      return `${today.slice(0, 4)}-01-01`;
    case "1Y":
      return shift(today, -365);
    case "All":
      return null;
  }
}

interface ValueChartProps {
  points: ChartPoint[];
  today: string;
}

interface TooltipPayload {
  payload?: { day: string; value: number };
}

function ChartTooltip({ active, payload, hidden }: { active?: boolean; payload?: TooltipPayload[]; hidden?: boolean }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 shadow-subtle">
      <p className="text-caption text-muted-foreground">{formatShortDate(point.day, true)}</p>
      <p className="font-mono text-body-sm tabular-nums text-popover-foreground">{formatMoney(point.value, "CAD", { hidden })}</p>
    </div>
  );
}

/** Portfolio value over time, from the daily snapshots each sync writes. */
export function ValueChart({ points, today }: ValueChartProps) {
  const hidden = useAmountsHidden();
  const [range, setRange] = useState<Range>("3M");
  const gradientId = useId().replace(/:/g, "");
  const start = rangeStart(range, today);
  const data = points.filter((p) => start === null || p.day >= start).map((p) => ({ day: p.day, value: Number(p.valueCad) }));
  const multiYear = data.length > 0 && data[0]!.day.slice(0, 4) !== data.at(-1)!.day.slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      <div role="group" aria-label="Time range" className="flex flex-wrap gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            aria-pressed={range === r}
            aria-label={RANGE_LABELS[r]}
            onClick={() => setRange(r)}
            className={cn(
              "h-7 min-w-9 rounded-sm border px-2 font-mono text-caption tabular-nums transition-colors",
              range === r
                ? "border-highlight-border bg-highlight text-highlight-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {data.length < 2 ? (
        <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 text-center">
          <LineChartIcon aria-hidden className="size-5 text-muted-foreground" />
          <p className="text-body-sm text-muted-foreground">
            {points.length < 2
              ? "History builds up from each daily sync. Check back tomorrow."
              : "No snapshots in this range yet. Try a longer one."}
          </p>
        </div>
      ) : (
        <div
          role="img"
          aria-label={`Portfolio value, ${RANGE_LABELS[range].toLowerCase()}: ${formatMoney(data[0]!.value, "CAD", { hidden })} on ${formatShortDate(data[0]!.day, true)}, ${formatMoney(data.at(-1)!.value, "CAD", { hidden })} on ${formatShortDate(data.at(-1)!.day, true)}.`}
          className="h-56 min-w-0"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeWidth={1} />
              <XAxis
                dataKey="day"
                tickFormatter={(day: string) => formatShortDate(day, multiYear)}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                minTickGap={32}
                tickMargin={8}
              />
              <YAxis
                width={56}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => formatCompactMoney(v, "CAD", { hidden })}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12, fontFamily: "var(--font-mono)" }}
                tickLine={false}
                axisLine={false}
                tickCount={4}
              />
              <Tooltip
                content={<ChartTooltip hidden={hidden} />}
                cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
