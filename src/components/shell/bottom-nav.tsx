"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ActiveIndicator } from "@/components/motion/active-indicator";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./nav-items";

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Main"
      data-bottom-nav
      className="fixed inset-x-0 bottom-0 z-10 h-(--bottom-nav-h) border-t bg-card lg:hidden"
    >
      <ul data-indicator-group className="isolate grid h-full grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-full flex-col items-center justify-center gap-1 text-caption font-medium transition-motion",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {/* A hairline on top of the active tab slides between tabs. */}
                {active && <ActiveIndicator group="bottom-nav" className="bottom-auto h-0.5 bg-primary" />}
                <item.icon aria-hidden className={cn("size-5 transition-motion", active && "text-primary")} />
                {item.shortLabel ?? item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
