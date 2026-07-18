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
  it("allows an active SUPER_ADMIN session role", () => {
    expect(canAccessRoute(session(["SUPER_ADMIN"], []), "System")).toBe(true);
  });

  it("denies ADMIN and direct System permissions", () => {
    const systemPermissions = ["system.configure", "user.read", "role.read", "permission.read", "session.manage"];
    expect(canAccessRoute(session(["ADMIN"], systemPermissions), "System")).toBe(false);
    expect(canAccessRoute(session(["CUSTOM_ROLE"], systemPermissions), "System")).toBe(false);
  });

  it("leaves non-System route permission checks unchanged", () => {
    const admin = session(["ADMIN"], ["audit.read", "settings.read"]);
    expect(canAccessRoute(admin, "Audit")).toBe(true);
    expect(canAccessRoute(admin, "Settings")).toBe(true);
  });
});
