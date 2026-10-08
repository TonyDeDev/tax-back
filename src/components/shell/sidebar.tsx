"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { HideAmountsToggle } from "@/components/amounts";
import { type ShellUser, UserMenu } from "@/components/auth/user-menu";
import { Brand } from "@/components/brand";
import { ActiveIndicator } from "@/components/motion/active-indicator";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, isActive } from "./nav-items";

export function Sidebar({ user }: { user: ShellUser }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-[calc(100dvh-var(--strip-space))] w-60 shrink-0 flex-col justify-between border-r bg-card p-4 lg:flex">
      <div className="flex flex-col gap-6">
        <Brand className="px-2 pt-2" />
        <nav aria-label="Main" data-indicator-group className="isolate flex flex-col gap-1">
          {NAV_ITEMS.map((item) => {
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex items-center gap-3 rounded-sm px-2 py-2 text-body-sm font-medium transition-motion",
                  active ? "text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                )}
              >
                {/* One highlight slides between items; labels crossfade through the color transition. */}
                {active && <ActiveIndicator group="sidebar" className="rounded-sm bg-accent" />}
                <item.icon aria-hidden className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex flex-col gap-3 border-t pt-4">
        <UserMenu user={user} className="px-2" />
        <div className="flex items-center justify-between px-2">
          <span className="text-caption text-muted-foreground">Theme</span>
          <HideAmountsToggle />
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
