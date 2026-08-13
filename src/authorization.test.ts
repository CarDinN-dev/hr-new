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

  it("allows Super Administrators to access Payroll", () => {
    expect(canAccessRoute(session(["SUPER_ADMIN"], ["payroll.read"]), "Payroll")).toBe(true);
  });

  it("allows employee Settings for signed-in device management", () => {
    expect(canAccessRoute(session(["EMPLOYEE"], ["session.self.read"]), "Settings")).toBe(true);
  });

  it("replaces the employee directory with the minimal Team route for organizational roles", () => {
    for (const role of ["EMPLOYEE", "LINE_MANAGER", "MANAGER"]) {
      const user = session([role], ["employee.department.read", "employee.self.read", "employee.management.read"]);
      expect(canAccessRoute(user, "Team")).toBe(true);
      expect(canAccessRoute(user, "Employees")).toBe(false);
    }
    for (const role of ["HR", "CPO", "COO"]) {
      const user = session([role], ["employee.department.read", "employee.read_all"]);
      expect(canAccessRoute(user, "Team")).toBe(true);
      expect(canAccessRoute(user, "Employees")).toBe(true);
    }
  });
});
