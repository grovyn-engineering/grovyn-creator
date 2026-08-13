import {
  Activity,
  Instagram,
  LayoutDashboard,
  Settings,
  Workflow,
  type LucideIcon,
} from "lucide-react";

/**
 * Navigation, defined once and consumed by both the desktop sidebar and the
 * mobile drawer, so the two cannot drift.
 *
 * Every entry points at a route that exists and does something. There are no
 * placeholder destinations — a nav item that leads to "coming soon" is worse
 * than no nav item, because it advertises a capability the product does not have.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Matches nested routes too, e.g. /workflows/abc under /workflows. */
  matchNested?: boolean;
}

export interface NavSection {
  /** Omitted for the first group, which needs no heading above it. */
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ label: "Overview", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    label: "Automation",
    items: [{ label: "Workflows", href: "/workflows", icon: Workflow, matchNested: true }],
  },
  {
    label: "Instagram",
    items: [
      { label: "Account", href: "/instagram", icon: Instagram },
      { label: "Activity", href: "/activity", icon: Activity },
    ],
  },
  {
    items: [{ label: "Settings", href: "/settings", icon: Settings, matchNested: true }],
  },
];

export function isActive(pathname: string, item: NavItem): boolean {
  if (item.matchNested) {
    // Guard the boundary so /workflows-archive does not light up /workflows.
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }
  return pathname === item.href;
}
