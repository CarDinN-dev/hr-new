import type { NavItem } from "./data";

export const navPaths = {
  Dashboard: "/",
  "My HR": "/me",
  "Approval Inbox": "/approvals",
  Notifications: "/notifications",
  Team: "/team",
  Employees: "/employees",
  Attendance: "/attendance",
  Leave: "/leave",
  "Business Trips": "/business-trips",
  Expenses: "/expenses",
  Loans: "/loans",
  Payroll: "/payroll",
  Recruitment: "/recruitment",
  Performance: "/performance",
  Announcements: "/announcements",
  Certificates: "/certificates",
  EOS: "/eos",
  Documents: "/documents",
  Reports: "/reports",
  Audit: "/audit",
  Hierarchy: "/hierarchy",
  System: "/system",
  Settings: "/settings"
} as const satisfies Record<NavItem, string>;

const navByPath = new Map<string, NavItem>(Object.entries(navPaths).map(([nav, path]) => [path, nav as NavItem]));

export function navItemForPath(pathname: string): NavItem | null {
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  if (normalized.startsWith("/announcements/")) return "Announcements";
  return navByPath.get(normalized) ?? null;
}
