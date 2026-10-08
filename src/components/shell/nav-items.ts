import { LayoutDashboard, PiggyBank, Receipt, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  /** For the phone's bottom bar, where four labels share the width. */
  shortLabel?: string;
  href: string;
  /** Path prefix that marks this item active. */
  match: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Hub", href: "/hub", match: "/hub", icon: LayoutDashboard },
  { label: "Tax Center", shortLabel: "Tax", href: "/tax", match: "/tax", icon: Receipt },
  { label: "Contributions", href: "/contributions", match: "/contributions", icon: PiggyBank },
  { label: "Settings", href: "/settings", match: "/settings", icon: Settings },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
