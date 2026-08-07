import type { NavItem } from "./data";

export const navPaths = {
  Dashboard: "/",
  "My HR": "/me",
  Employees: "/employees",
  Attendance: "/attendance",
  Leave: "/leave",
  Loans: "/loans",
  Payroll: "/payroll",
  Recruitment: "/recruitment",
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
  return navByPath.get(normalized) ?? null;
}
