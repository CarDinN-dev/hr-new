import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { BackendSession } from "./api";
import { hasAllPermissions, hasAnyPermission, hasPermission } from "./api";
import type { NavItem } from "./data";

const routePermissions: Record<NavItem, string[]> = {
  Dashboard: ["session.self.read"],
  "My HR": ["employee.self.read"],
  Team: ["employee.team.read", "employee.department.read"],
  Employees: ["employee.self.read", "employee.team.read", "employee.department.read", "employee.hr.read", "employee.audit.read"],
  Attendance: ["attendance.self.read", "attendance.team.read", "attendance.department.read", "attendance.hr.read", "attendance.audit.read"],
  Leave: ["leave.self.read", "leave.team.read", "leave.department.read", "leave.hr.read", "leave.audit.read"],
  "Business Trips": ["trip.self.read", "trip.team.read", "trip.department.read", "trip.hr.read", "trip.audit.read"],
  Expenses: ["expense.self.read", "expense.team.read", "expense.department.read", "expense.hr.read", "expense.audit.read"],
  Loans: ["loan.self.read", "loan.hr.read", "loan.audit.read"],
  Payroll: ["payroll.self.read_payslip", "payroll.read", "payroll.audit.read"],
  Recruitment: ["recruitment.read"],
  EOS: ["eos.read"],
  Documents: ["document.self.read", "document.hr.read"],
  Reports: ["report.read"],
  Audit: ["audit.read"],
  System: ["user.read", "role.read", "permission.read", "session.manage", "system.configure"],
  Settings: ["department.manage", "position.manage", "leave.configure", "system.configure"]
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
    canAccessRoute: route => hasAnyPermission(session, ...routePermissions[route])
  }), [session]);
  return <AuthorizationContext.Provider value={value}>{children}</AuthorizationContext.Provider>;
}

export function useAuthorization() {
  const context = useContext(AuthorizationContext);
  if (!context) throw new Error("AuthorizationProvider is required");
  return context;
}

export function canAccessRoute(session: BackendSession, route: NavItem) {
  return hasAnyPermission(session, ...routePermissions[route]);
}
