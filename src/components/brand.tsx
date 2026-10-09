import Link from "next/link";
import { useId } from "react";
import { cn } from "@/lib/utils";

// The rising arrow, drawn on a 64 unit grid. The mask cuts a gap around it so it never touches the bars.
const ARROW = "M17 39.4Q31 35 53 13";
const ARROW_HEAD = "M42.22 13.56L53 13L52.44 23.78";

/** The Snap Tax Back mark: a tax form with rising bars and an arrow coming back out. Ink follows `currentColor`, the arrow is `primary`. */
export function LogoMark({ className }: { className?: string }) {
  const maskId = useId();
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-6 shrink-0", className)}>
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
        <rect width="64" height="64" fill="white" />
        <g fill="none" stroke="black" strokeWidth="10" strokeLinecap="round" strokeLinejoin="round">
          <path d={ARROW} />
          <path d={ARROW_HEAD} />
        </g>
      </mask>
      <g mask={`url(#${maskId})`} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M34 6H11a3 3 0 0 0-3 3v46a3 3 0 0 0 3 3h34a3 3 0 0 0 3-3V32" />
        <path d="M16 15h12M16 22h7" />
        <g fill="currentColor" stroke="none">
          <rect x="16" y="44" width="6" height="8" rx="1" />
          <rect x="25" y="38" width="6" height="14" rx="1" />
          <rect x="34" y="32" width="6" height="20" rx="1" />
        </g>
      </g>
      <g fill="none" className="stroke-primary" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={ARROW} />
        <path d={ARROW_HEAD} />
      </g>
    </svg>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2 font-display text-subheading font-bold text-foreground", className)}
    >
      <LogoMark className="size-7" />
      <span className="whitespace-nowrap">
        Snap Tax <span className="text-primary">Back</span>
      </span>
    </Link>
  );
}
