import { describe, expect, it } from "vitest";
import type { BackendSession } from "./api";
import { canAccessRoute } from "./authorization";

function session(roles: string[], permissions: string[]): BackendSession {
  return {
    id: "user-1",
    email: "user@example.invalid",
    displayName: "Test User",
    csrfToken: "csrf",
    roles,
    permissions,
    departmentScopeIds: [],
    sessionId: "session-1",
    authProvider: "local",
    authorizationVersion: 1
  };
}

describe("System route authorization", () => {
  it("allows active administrators into System and company leadership into Hierarchy", () => {
    expect(canAccessRoute(session(["SUPER_ADMIN"], []), "System")).toBe(true);
    expect(canAccessRoute(session(["ADMIN"], []), "System")).toBe(true);
    for (const role of ["HR", "COO", "CPO", "SUPER_ADMIN", "ADMIN"]) {
      expect(canAccessRoute(session([role], []), "Hierarchy")).toBe(true);
    }
  });

  it("denies direct System permissions without an administrator role", () => {
    const systemPermissions = ["system.configure", "user.read", "role.read", "permission.read", "session.manage"];
    expect(canAccessRoute(session(["CUSTOM_ROLE"], systemPermissions), "System")).toBe(false);
    expect(canAccessRoute(session(["CUSTOM_ROLE"], systemPermissions), "Hierarchy")).toBe(false);
  });

  it("leaves non-System route permission checks unchanged", () => {
    const admin = session(["ADMIN"], ["audit.read", "settings.read"]);
    expect(canAccessRoute(admin, "Audit")).toBe(true);
    expect(canAccessRoute(admin, "Settings")).toBe(true);
  });

  it("keeps employees in their team area and out of directory and personal finance routes", () => {
    const employee = session(["EMPLOYEE"], ["employee.self.read", "trip.self.read", "expense.self.read", "loan.self.read"]);
    expect(canAccessRoute(employee, "Team")).toBe(true);
    for (const route of ["Employees", "Business Trips", "Expenses", "Loans"] as const) expect(canAccessRoute(employee, route)).toBe(false);
    expect(canAccessRoute(session(["LINE_MANAGER"], ["employee.team.read"]), "Team")).toBe(true);
    expect(canAccessRoute(session(["HR"], ["employee.hr.read", "trip.hr.read", "expense.hr.read", "loan.hr.read"]), "Employees")).toBe(true);
  });

  it("allows Super Administrators to access Payroll", () => {
    expect(canAccessRoute(session(["SUPER_ADMIN"], ["payroll.read"]), "Payroll")).toBe(true);
  });

  it("allows employee Settings for signed-in device management", () => {
    expect(canAccessRoute(session(["EMPLOYEE"], ["session.self.read"]), "Settings")).toBe(true);
  });
});
