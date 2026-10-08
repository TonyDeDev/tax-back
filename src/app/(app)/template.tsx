import type { ReactNode } from "react";

/**
 * Remounts on every navigation, so each page's top-level blocks fade up 8px in turn (400ms, 40ms apart,
 * capped at the sixth). `contents` keeps the shell's flex column and gaps working on the page itself.
 */
export default function AppTemplate({ children }: { children: ReactNode }) {
  return <div className="motion-stagger contents">{children}</div>;
}
