import { cn } from "@/lib/utils";

interface RoomMeterProps {
  /** Room available for the year. */
  room: number;
  /** Room used so far; above `room` is an excess. */
  used: number;
  label: string;
}

/**
 * How much of the year's room is used. Display only: both numbers are saved results. Over the limit,
 * the whole bar turns to the loss color, since the excess is what matters then.
 */
export function RoomMeter({ room, used, label }: RoomMeterProps) {
  const over = used > room;
  const share = room <= 0 ? (used > 0 ? 1 : 0) : Math.min(used / room, 1);
  return (
    <div
      role="meter"
      aria-label={label}
      // A share rather than dollars, so hidden amounts stay hidden from screen readers too.
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(share * 100)}
      aria-valuetext={over ? "Over the limit" : `${Math.round(share * 100)}% used`}
      className="h-1.5 w-full overflow-hidden rounded-sm bg-muted"
    >
      <div className={cn("h-full rounded-sm", over ? "bg-negative" : "bg-chart-1")} style={{ width: `${share * 100}%` }} />
    </div>
  );
}
