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

  it("uses the existing trip and expense read permissions for their restored routes", () => {
    expect(canAccessRoute(session(["EMPLOYEE"], ["trip.self.read"]), "Business Trips")).toBe(true);
    expect(canAccessRoute(session(["EMPLOYEE"], ["expense.self.read"]), "Expenses")).toBe(true);
    expect(canAccessRoute(session(["EMPLOYEE"], ["trip.self.read"]), "Expenses")).toBe(false);
    expect(canAccessRoute(session(["EMPLOYEE"], ["expense.self.read"]), "Business Trips")).toBe(false);
  });

  it("allows Super Administrators to access Payroll", () => {
    expect(canAccessRoute(session(["SUPER_ADMIN"], ["payroll.read"]), "Payroll")).toBe(true);
  });

  it("allows employee Settings for signed-in device management", () => {
    expect(canAccessRoute(session(["EMPLOYEE"], ["session.self.read"]), "Settings")).toBe(true);
  });
});
