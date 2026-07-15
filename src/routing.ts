import type { NavItem } from "./data";

export const navPaths = {
  Dashboard: "/",
  "My HR": "/me",
  Team: "/team",
  Employees: "/employees",
  Attendance: "/attendance",
  Leave: "/leave",
  "Business Trips": "/business-trips",
  Expenses: "/expenses",
  Loans: "/loans",
  Payroll: "/payroll",
  Recruitment: "/recruitment",
  EOS: "/eos",
  Documents: "/documents",
  Reports: "/reports",
  Audit: "/audit",
  System: "/system",
  Settings: "/settings"
} as const satisfies Record<NavItem, string>;

const navByPath = new Map<string, NavItem>(Object.entries(navPaths).map(([nav, path]) => [path, nav as NavItem]));

export function navItemForPath(pathname: string): NavItem {
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return navByPath.get(normalized) ?? "Dashboard";
}
