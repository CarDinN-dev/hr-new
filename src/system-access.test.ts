import { describe, expect, it } from "vitest";
import { canUseRoleFlow, roleFlowCodes, roleFlowReview } from "./features/system-access";

describe("guided role assignment", () => {
  it("always includes the employee baseline", () => {
    expect(roleFlowCodes({ directReports: false, managesManagers: false, hrDuties: false })).toEqual(["EMPLOYEE"]);
  });

  it("adds line-manager access when management-tree access is selected", () => {
    expect(roleFlowCodes({ directReports: false, managesManagers: true, hrDuties: false })).toEqual(["EMPLOYEE", "LINE_MANAGER", "MANAGER"]);
  });

  it("preserves locked and custom roles while reporting exact changes", () => {
    expect(roleFlowReview(["EMPLOYEE", "HR", "CPO", "CUSTOM_FINANCE"], {
      directReports: true, managesManagers: true, hrDuties: false,
    })).toEqual({
      desired: ["EMPLOYEE", "LINE_MANAGER", "MANAGER"],
      locked: ["CPO", "CUSTOM_FINANCE"],
      additions: ["LINE_MANAGER", "MANAGER"],
      removals: ["HR"],
      resulting: ["CPO", "CUSTOM_FINANCE", "EMPLOYEE", "LINE_MANAGER", "MANAGER"],
    });
  });

  it("is visible only to Admin and Super Admin sessions", () => {
    expect(canUseRoleFlow({ roles: ["ADMIN"] })).toBe(true);
    expect(canUseRoleFlow({ roles: ["SUPER_ADMIN"] })).toBe(true);
    expect(canUseRoleFlow({ roles: ["HR", "MANAGER"] })).toBe(false);
  });
});
