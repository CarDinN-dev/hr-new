import { describe, expect, it } from "vitest";
import { buildOrganizationHierarchy, buildRoleFlowGraph, buildVisibleRoleFlow, hierarchyInheritancePayload, hierarchyLineManagerCode, hierarchyManagerCode, hierarchyReportingPayload, hierarchyUserParams, pruneExpandedRoleCodes } from "./features/hierarchy-page";

const employee = (id: string, code: string, fields: Record<string, string> = {}, roleCodes: string[] = []) => ({
  id,
  status: "Active" as const,
  roleCodes,
  fields: { "Employee Code": code, "Full Name": id, Designation: "Specialist", ...fields },
});

const accessRole = (code: string, inherits: string[] = [], isBuiltIn = true) => ({
  id: `role-${code.toLowerCase()}`,
  code,
  displayName: code.replaceAll("_", " "),
  version: 1,
  isBuiltIn,
  isActive: true,
  protection: code === "SUPER_ADMIN" ? "SUPER_ADMIN" as const : "STANDARD" as const,
  inherits,
});

describe("hierarchy page requests", () => {
  it("combines direct-role filtering and sends versioned inheritance changes", () => {
    expect(hierarchyUserParams("Taylor", "role-hr").toString()).toBe("search=Taylor&roleId=role-hr");
    expect(hierarchyInheritancePayload({ role: { id: "role-custom", code: "CUSTOM", displayName: "Custom", version: 3, isBuiltIn: false, isActive: true, protection: "STANDARD", inherits: [] }, parentRoleIds: new Set(["role-employee", "role-hr"]), reason: "  Add inherited access  " })).toEqual({ parentRoleIds: ["role-employee", "role-hr"], expectedVersion: 3, reason: "Add inherited access" });
  });

  it("builds and progressively reveals a reduced role inheritance graph", () => {
    const graph = buildRoleFlowGraph([
      accessRole("ADMIN", ["EMPLOYEE"]),
      accessRole("EMPLOYEE"),
      accessRole("HR", ["EMPLOYEE"]),
      accessRole("SUPER_ADMIN", ["EMPLOYEE", "HR", "ADMIN"]),
      accessRole("CUSTOM_VIEWER", ["EMPLOYEE", "HR"], false),
    ]);

    expect(graph.roots.map(role => role.code)).toEqual(["SUPER_ADMIN", "CUSTOM_VIEWER"]);
    expect(graph.childrenByCode.get("SUPER_ADMIN")?.map(role => role.code)).toEqual(["ADMIN", "HR"]);
    expect(graph.childrenByCode.get("CUSTOM_VIEWER")?.map(role => role.code)).toEqual(["HR"]);
    expect(buildVisibleRoleFlow(graph, false, new Set()).levels).toEqual([]);
    expect(buildVisibleRoleFlow(graph, true, new Set()).levels.map(level => level.map(role => role.code))).toEqual([["SUPER_ADMIN", "CUSTOM_VIEWER"]]);

    const shared = buildVisibleRoleFlow(graph, true, new Set(["SUPER_ADMIN", "ADMIN", "HR"]));
    expect(shared.levels.map(level => level.map(role => role.code))).toEqual([["SUPER_ADMIN", "CUSTOM_VIEWER"], ["ADMIN", "HR"], ["EMPLOYEE"]]);
    expect(shared.edges.filter(edge => edge.targetCode === "EMPLOYEE").map(edge => edge.sourceCode)).toEqual(["ADMIN", "HR"]);
    expect(buildVisibleRoleFlow(graph, true, new Set(["SUPER_ADMIN", "ADMIN"])).visibleCodes.has("EMPLOYEE")).toBe(true);
    expect([...pruneExpandedRoleCodes(graph, true, new Set(["ADMIN", "HR"]))]).toEqual([]);
  });

  it("builds the employee tree from reporting assignments instead of job titles", () => {
    const hierarchy = buildOrganizationHierarchy([
      employee("manager", "MGR-01", { Designation: "Commercial Director" }),
      employee("line", "LINE-01", { Designation: "Workshop Foreman", "Manager Employee Code/Name": "MGR-01 - manager" }),
      employee("staff", "EMP-01", { Designation: "Engineer", "Line Manager Employee Code/Name": "LINE-01 - line", "Manager Employee Code/Name": "MGR-01 - manager" }),
      employee("fallback", "EMP-02", { "Line Manager Employee Code/Name": "MISSING - Missing", "Manager Employee Code/Name": "MGR-01 - manager" }),
      employee("root", "ROOT-01"),
    ]);

    expect(hierarchy.roots.map(node => node.employee.id)).toEqual(["manager", "root"]);
    const manager = hierarchy.roots[0];
    expect(manager.role).toBe("MANAGER");
    expect(manager.children.map(node => node.employee.id)).toEqual(["line", "fallback"]);
    expect(manager.children[0]).toMatchObject({ role: "LINE_MANAGER", roleLabel: "Line manager" });
    expect(manager.children[0].children[0].employee.id).toBe("staff");
    expect(hierarchy.issues).toEqual([{ employee: expect.objectContaining({ id: "fallback" }), message: "Line Manager does not match another active employee." }]);
  });

  it("uses the dedicated links for manager and line-manager hierarchy levels", () => {
    const employee = { id: "employee-1", status: "Active" as const, fields: {
      Designation: "Employee", "Line Manager Employee Code/Name": "LINE-01 - Lina Lead", "Manager Employee Code/Name": "MGR-01 - Dana Manager",
    } };
    expect(hierarchyLineManagerCode(employee)).toBe("line-01");
    expect(hierarchyManagerCode(employee)).toBe("mgr-01");
    const legacyEmployee = { id: "employee-2", status: "Active" as const, fields: { "Reporting Manager Employee Code/Name": "LINE-02 - Legacy Lead" } };
    expect(hierarchyLineManagerCode(legacyEmployee)).toBe("line-02");
    expect(hierarchyManagerCode(legacyEmployee)).toBe("");
  });

  it("shows combined reporting roles and keeps every employee visible when a cycle exists", () => {
    const hierarchy = buildOrganizationHierarchy([
      employee("a", "A", { "Line Manager Employee Code/Name": "B - b" }),
      employee("b", "B", { "Manager Employee Code/Name": "A - a" }),
      employee("c", "C", { "Line Manager Employee Code/Name": "B - b" }),
      employee("d", "D", { "Manager Employee Code/Name": "B - b" }),
    ]);
    const root = hierarchy.roots[0];
    expect(root.employee.id).toBe("a");
    expect(root.children[0]).toMatchObject({ employee: expect.objectContaining({ id: "b" }), roleLabel: "Manager / Line manager" });
    expect([root.employee.id, root.children[0].employee.id, ...root.children[0].children.map(node => node.employee.id)].sort()).toEqual(["a", "b", "c", "d"]);
    expect(hierarchy.issues).toContainEqual({ employee: expect.objectContaining({ id: "a" }), message: "Reporting cycle was broken here so every employee remains visible." });
  });

  it("shows active executive and HR roles without changing reporting placement", () => {
    const hierarchy = buildOrganizationHierarchy([
      employee("Hafiz", "TEMP-COO-HAFIZ", {}, ["COO"]),
      employee("Ahmed", "MTC082", { "Line Manager Employee Code/Name": "TEMP-COO-HAFIZ - Hafiz" }),
      employee("Zahira", "TEMP-CPO-ZAHIRA", { "Manager Employee Code/Name": "TEMP-COO-HAFIZ - Hafiz" }, ["CPO"]),
      employee("Aboobacker", "MTC037", { "Line Manager Employee Code/Name": "TEMP-CPO-ZAHIRA - Zahira" }),
      employee("Mukesh Krishna", "MTC158", {
        "Line Manager Employee Code/Name": "TEMP-CPO-ZAHIRA - Zahira",
        "Manager Employee Code/Name": "TEMP-CPO-ZAHIRA - Zahira",
      }, ["HR"]),
    ]);

    const hafiz = hierarchy.roots[0];
    expect(hafiz).toMatchObject({ employee: { id: "Hafiz" }, roleLabel: "COO" });
    expect(hafiz.children.map(node => node.employee.id)).toEqual(["Zahira", "Ahmed"]);
    expect(hafiz.children[0]).toMatchObject({ employee: { id: "Zahira" }, roleLabel: "CPO" });
    expect(hafiz.children[0].children.map(node => node.employee.id)).toEqual(["Mukesh Krishna", "Aboobacker"]);
    expect(hafiz.children[0].children[0]).toMatchObject({ employee: { id: "Mukesh Krishna" }, roleLabel: "HR" });
  });

  it("saves both reporting links", () => {
    expect(hierarchyReportingPayload("line-manager-1", "manager-1")).toEqual({ lineManagerId: "line-manager-1", managerId: "manager-1" });
    expect(hierarchyReportingPayload("", "")).toEqual({ lineManagerId: null, managerId: null });
  });
});
