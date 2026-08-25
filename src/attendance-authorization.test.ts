import { describe, expect, it } from "vitest";
import type { BackendSession } from "./api";
import { canAccessRoute } from "./authorization";

function session(role: string, permissions: string[]): BackendSession {
  return {
    id: `user-${role}`,
    email: `${role.toLowerCase()}@example.invalid`,
    displayName: role,
    csrfToken: "csrf",
    roles: [role],
    permissions,
    departmentScopeIds: [],
    sessionId: `session-${role}`,
    authProvider: "local",
    authorizationVersion: 1,
    employeeId: `employee-${role}`,
  };
}

describe("attendance route privacy", () => {
  it.each([
    ["EMPLOYEE", ["attendance.self.read"]],
    ["LINE_MANAGER", ["attendance.team.read"]],
    ["MANAGER", ["attendance.management.read"]],
  ])("blocks %s even if a stale legacy attendance permission is present", (role, permissions) => {
    expect(canAccessRoute(session(role, permissions), "Attendance")).toBe(false);
  });

  it.each([
    ["HR", ["attendance.hr.read"]],
    ["CPO", ["attendance.read_all"]],
    ["COO", ["attendance.read_all"]],
    ["ADMIN", ["attendance.read_all"]],
    ["SUPER_ADMIN", ["attendance.read_all"]],
  ])("allows %s with an HR-or-higher attendance grant", (role, permissions) => {
    expect(canAccessRoute(session(role, permissions), "Attendance")).toBe(true);
  });
});
