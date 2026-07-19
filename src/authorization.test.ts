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
  it("allows active ADMIN and SUPER_ADMIN session roles", () => {
    expect(canAccessRoute(session(["SUPER_ADMIN"], []), "System")).toBe(true);
    expect(canAccessRoute(session(["ADMIN"], []), "System")).toBe(true);
  });

  it("denies direct System permissions without an administrator role", () => {
    const systemPermissions = ["system.configure", "user.read", "role.read", "permission.read", "session.manage"];
    expect(canAccessRoute(session(["CUSTOM_ROLE"], systemPermissions), "System")).toBe(false);
  });

  it("leaves non-System route permission checks unchanged", () => {
    const admin = session(["ADMIN"], ["audit.read", "settings.read"]);
    expect(canAccessRoute(admin, "Audit")).toBe(true);
    expect(canAccessRoute(admin, "Settings")).toBe(true);
  });
});
