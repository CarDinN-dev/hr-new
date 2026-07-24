import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BackendSession } from "./api";
import { hasActiveSystemAdministratorRole, hasAllPermissions, hasAnyPermission, hasPermission } from "./api";
import type { NavItem } from "./data";

const routePermissions: Record<NavItem, string[]> = {
  Dashboard: ["session.self.read"],
  "My HR": ["employee.self.read", "leave.self.read", "service_request.self.read", "payroll.self.read_payslip", "session.self.read"],
  Team: ["employee.team.read", "employee.management.read", "leave.team.read", "leave.management.read"],
  Employees: ["employee.self.read", "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all"],
  Attendance: ["attendance.self.read", "attendance.team.read", "attendance.management.read", "attendance.hr.read", "attendance.read_all"],
  Leave: ["leave.self.read", "leave.team.read", "leave.management.read", "leave.hr.read", "leave.audit.read", "leave.read_all"],
  "Business Trips": ["trip.self.read", "trip.team.read", "trip.management.read", "trip.hr.read", "trip.read_all"],
  Expenses: ["expense.self.read", "expense.team.read", "expense.management.read", "expense.hr.read", "expense.read_all"],
  Loans: ["loan.self.read", "loan.hr.read", "loan.audit.read", "loan.read_all"],
  Payroll: ["payroll.self.read_payslip", "payroll.read", "payroll.audit.read"],
  Recruitment: ["recruitment.read"],
  EOS: ["eos.read"],
  Documents: ["document.self.read", "document.hr.read", "document.read_all"],
  Reports: ["report.read"],
  Audit: ["audit.read"],
  System: [],
  Settings: ["settings.read", "settings.manage", "department.manage", "position.manage", "leave.configure"]
};

export type AuthorizationContextValue = {
  session: BackendSession;
  scopes: { employeeId: string | null; departmentIds: string[] };
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (...permissions: string[]) => boolean;
  hasAllPermissions: (...permissions: string[]) => boolean;
  canAccessRoute: (route: NavItem) => boolean;
};

const AuthorizationContext = createContext<AuthorizationContextValue | null>(null);

export function AuthorizationProvider({ session, children }: { session: BackendSession; children: ReactNode }) {
  const value = useMemo<AuthorizationContextValue>(() => ({
    session,
    scopes: { employeeId: session.employeeId ?? null, departmentIds: session.departmentScopeIds },
    hasPermission: permission => hasPermission(session, permission),
    hasAnyPermission: (...permissions) => hasAnyPermission(session, ...permissions),
    hasAllPermissions: (...permissions) => hasAllPermissions(session, ...permissions),
    canAccessRoute: route => canAccessRoute(session, route)
  }), [session]);
  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}

export function useAuthorization() {
  const context = useContext(AuthorizationContext);
  if (!context) throw new Error("AuthorizationProvider is required");
  return context;
}

export function canAccessRoute(session: BackendSession, route: NavItem) {
  if (route === "System") return hasActiveSystemAdministratorRole(session);
  if (route === "Payroll") return ["HR", "CPO", "COO"].some(role => session.roles.includes(role));
  return hasAnyPermission(session, ...routePermissions[route]);
}
