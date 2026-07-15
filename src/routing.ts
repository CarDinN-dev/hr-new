import type { NavItem } from "./data";

export const navPaths = {
  Dashboard: "/",
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
  Settings: "/settings"
} as const satisfies Record<NavItem, string>;

const navByPath = new Map<string, NavItem>(Object.entries(navPaths).map(([nav, path]) => [path, nav as NavItem]));

export function navItemForPath(pathname: string): NavItem {
  const normalized = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  return navByPath.get(normalized) ?? "Dashboard";
}
