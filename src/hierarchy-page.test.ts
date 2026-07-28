import { describe, expect, it } from "vitest";
import { hierarchyInheritancePayload, hierarchyManagerCode, hierarchyNodeRole, hierarchyUserParams } from "./features/hierarchy-page";

describe("hierarchy page requests", () => {
  it("combines direct-role filtering and sends versioned inheritance changes", () => {
    expect(hierarchyUserParams("Taylor", "role-hr").toString()).toBe("search=Taylor&roleId=role-hr");
    expect(hierarchyInheritancePayload({ role: { id: "role-custom", code: "CUSTOM", displayName: "Custom", version: 3, isBuiltIn: false, isActive: true, protection: "STANDARD", inherits: [] }, parentRoleIds: new Set(["role-employee", "role-hr"]), reason: "  Add inherited access  " })).toEqual({ parentRoleIds: ["role-employee", "role-hr"], expectedVersion: 3, reason: "Add inherited access" });
  });

  it("classifies reporting nodes and reads their manager code", () => {
    const employee = { id: "line-1", status: "Active" as const, fields: { Designation: "Line Manager", "Reporting Manager Employee Code/Name": "MGR-01 - Dana Ali" } };
    expect(hierarchyNodeRole(employee)).toBe("LINE_MANAGER");
    expect(hierarchyManagerCode(employee)).toBe("mgr-01");
  });
});
