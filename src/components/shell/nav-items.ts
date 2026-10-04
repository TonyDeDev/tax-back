import { LayoutDashboard, Receipt, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  /** Path prefix that marks this item active. */
  match: string;
  icon: LucideIcon;
}

/** Tax year the Tax Center links open on until real data decides it. */
export const DEFAULT_TAX_YEAR = 2026;

export const NAV_ITEMS: NavItem[] = [
  { label: "Hub", href: "/hub", match: "/hub", icon: LayoutDashboard },
  { label: "Tax Center", href: `/tax/${DEFAULT_TAX_YEAR}`, match: "/tax", icon: Receipt },
  { label: "Settings", href: "/settings", match: "/settings", icon: Settings },
];

export function isActive(pathname: string, item: NavItem): boolean {
  return pathname === item.match || pathname.startsWith(`${item.match}/`);
}
