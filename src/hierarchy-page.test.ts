import { describe, expect, it } from "vitest";
import {
  buildOrganizationHierarchy,
  buildRoleAssigneeMap,
  buildRoleFlowGraph,
  buildVisibleEmployeeFlow,
  buildVisibleRoleFlow,
  employeeHierarchySearchPath,
  hierarchyInheritancePayload,
  hierarchyLineManagerCode,
  hierarchyManagerCode,
  hierarchyReportingPayload,
  hierarchyUserParams,
  pruneExpandedEmployeeIds,
  pruneExpandedRoleCodes,
  unassignedReportingRootId,
} from "./features/hierarchy-page";

const employee = (
  id: string,
  code: string,
  fields: Record<string, string> = {},
  roleCodes: string[] = [],
  reporting: { lineManagerId?: string | null; managerId?: string | null } = {},
) => ({
  id,
  status: "Active" as const,
  roleCodes,
  fields: { "Employee Code": code, "Full Name": id, Designation: "Specialist", ...fields },
  ...reporting,
});

const accessRole = (code: string, inherits: string[] = [], isBuiltIn = true) => ({
  id: "role-" + code.toLowerCase(),
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

  it("maps active employees to every directly assigned active access role", () => {
    const inactiveRole = { ...accessRole("ARCHIVED"), isActive: false };
    const assignees = buildRoleAssigneeMap(
      [accessRole("EMPLOYEE"), accessRole("HR", ["EMPLOYEE"]), accessRole("CUSTOM_VIEWER", [], false), inactiveRole],
      [
        employee("amy", "EMP-001", { "Full Name": "Amy Adams", Department: "Engineering" }, ["HR", "HR"]),
        { ...employee("zoe", "EMP-002", { "Full Name": "Zoe Zane", Department: "Finance" }, ["HR", "CUSTOM_VIEWER"]), status: "On Leave" as const },
        employee("fallback", "EMP-003", { "Full Name": "", Department: "" }, ["CUSTOM_VIEWER"]),
        { ...employee("former", "EMP-004", { Department: "Finance" }, ["HR"]), status: "Resigned" as const },
        { ...employee("terminated", "EMP-006", { Department: "Finance" }, ["CUSTOM_VIEWER"]), status: "Terminated" as const },
        employee("archived", "EMP-005", { Department: "Operations" }, ["ARCHIVED"]),
      ],
    );

    expect(assignees.get("HR")).toEqual([
      { id: "amy", name: "Amy Adams", department: "Engineering" },
      { id: "zoe", name: "Zoe Zane", department: "Finance" },
    ]);
    expect(assignees.get("CUSTOM_VIEWER")).toEqual([
      { id: "fallback", name: "EMP-003", department: "Department not assigned" },
      { id: "zoe", name: "Zoe Zane", department: "Finance" },
    ]);
    expect(assignees.get("EMPLOYEE")).toEqual([]);
    expect(assignees.has("ARCHIVED")).toBe(false);
  });

  it("uses saved reporting IDs for primary and additional Manager relationships", () => {
    const graph = buildOrganizationHierarchy([
      employee("lead", "LEAD", { "Full Name": "Executive Lead", Designation: "Operations Director" }),
      employee("manager", "MGR", { "Full Name": "Department Manager", Department: "Operations" }, [], { lineManagerId: "lead", managerId: null }),
      employee("line", "LINE", { "Full Name": "Line Lead", Department: "Operations" }, [], { lineManagerId: "manager", managerId: "manager" }),
      employee("staff", "EMP", { "Full Name": "Employee", Department: "Operations", "Line Manager Employee Code/Name": "STALE - Stale" }, [], { lineManagerId: "line", managerId: "manager" }),
      employee("manager-only", "EMP2", { "Full Name": "Manager Fallback", Department: "Finance" }, [], { lineManagerId: null, managerId: "manager" }),
      employee("unassigned", "NONE", { "Full Name": "No Reporting Link" }, ["COO"], { lineManagerId: null, managerId: null }),
    ]);

    expect(graph.roots.map(item => item.id)).toEqual(["lead"]);
    expect(graph.unassignedRoots.map(item => item.id)).toEqual(["unassigned"]);
    expect(graph.primaryParentById.get("staff")).toBe("line");
    expect(graph.primaryRelationById.get("line")).toBe("BOTH");
    expect(graph.primaryRelationById.get("manager-only")).toBe("MANAGER");
    expect(graph.secondaryManagerEdges).toContainEqual({ sourceId: "manager", targetId: "staff", relation: "MANAGER", secondary: true });
    expect(graph.lineManagerIds).toEqual(new Set(["lead", "manager", "line"]));
    expect(graph.managerIds).toEqual(new Set(["manager"]));
    expect(graph.issues).toEqual([]);
  });

  it("progressively reveals branches, searches reporting paths, and prunes collapsed descendants", () => {
    const graph = buildOrganizationHierarchy([
      employee("lead", "LEAD", { "Full Name": "Executive Lead" }),
      employee("team", "TEAM", { "Full Name": "Team Lead", Department: "Field Services" }, [], { lineManagerId: "lead" }),
      employee("staff", "STAFF", { "Full Name": "Alex Worker", Designation: "Engineer", Department: "Field Services" }, [], { lineManagerId: "team" }),
      employee("unassigned", "NONE", { "Full Name": "Unassigned Person" }, [], { lineManagerId: null, managerId: null }),
    ]);

    expect(buildVisibleEmployeeFlow(graph, new Set()).levels.map(level => level.map(node => node.id))).toEqual([["lead", unassignedReportingRootId]]);
    expect(buildVisibleEmployeeFlow(graph, new Set(["lead"])).levels.map(level => level.map(node => node.id))).toEqual([["lead", unassignedReportingRootId], ["team"]]);
    expect(buildVisibleEmployeeFlow(graph, new Set(["lead", "team"])).levels.map(level => level.map(node => node.id))).toEqual([["lead", unassignedReportingRootId], ["team"], ["staff"]]);
    expect(buildVisibleEmployeeFlow(graph, new Set([unassignedReportingRootId])).visibleIds.has("unassigned")).toBe(true);
    expect([...pruneExpandedEmployeeIds(graph, new Set(["team"]))]).toEqual([]);

    const search = employeeHierarchySearchPath(graph, "engineer");
    expect(search.matchedIds).toEqual(new Set(["staff"]));
    expect(search.visibleIds).toEqual(new Set(["staff", "team", "lead"]));
    expect(buildVisibleEmployeeFlow(graph, search.visibleIds, search.visibleIds).visibleIds).toEqual(search.visibleIds);

    const unassignedSearch = employeeHierarchySearchPath(graph, "unassigned person");
    expect(unassignedSearch.visibleIds).toEqual(new Set(["unassigned", unassignedReportingRootId]));
  });

  it("falls back to Manager, excludes inactive employees, and reports invalid active links", () => {
    const graph = buildOrganizationHierarchy([
      employee("lead", "LEAD"),
      employee("staff", "STAFF", {}, [], { lineManagerId: "missing", managerId: "lead" }),
      { ...employee("former", "FORMER", {}, [], { lineManagerId: "lead" }), status: "Resigned" as const },
    ]);

    expect(graph.activeEmployees.map(item => item.id)).toEqual(["lead", "staff"]);
    expect(graph.primaryParentById.get("staff")).toBe("lead");
    expect(graph.primaryRelationById.get("staff")).toBe("MANAGER");
    expect(graph.issues).toEqual([{ employee: expect.objectContaining({ id: "staff" }), message: "Line Manager is not an active employee in this hierarchy." }]);
  });

  it("uses legacy labels only when reporting IDs are absent", () => {
    const legacy = { id: "employee-1", status: "Active" as const, fields: {
      Designation: "Employee", "Line Manager Employee Code/Name": "LINE-01 - Lina Lead", "Manager Employee Code/Name": "MGR-01 - Dana Manager",
    } };
    expect(hierarchyLineManagerCode(legacy)).toBe("line-01");
    expect(hierarchyManagerCode(legacy)).toBe("mgr-01");
    const older = { id: "employee-2", status: "Active" as const, fields: { "Reporting Manager Employee Code/Name": "LINE-02 - Legacy Lead" } };
    expect(hierarchyLineManagerCode(older)).toBe("line-02");
    expect(hierarchyManagerCode(older)).toBe("");
  });

  it("combines identical links and keeps every employee visible when a cycle exists", () => {
    const graph = buildOrganizationHierarchy([
      employee("a", "A", {}, [], { lineManagerId: "b" }),
      employee("b", "B", {}, [], { managerId: "a" }),
      employee("c", "C", {}, [], { lineManagerId: "b", managerId: "b" }),
      employee("d", "D", {}, [], { managerId: "b" }),
    ]);

    expect(graph.roots.map(item => item.id)).toEqual(["a"]);
    expect(graph.primaryRelationById.get("c")).toBe("BOTH");
    expect(graph.childrenByParentId.get("b")?.map(item => item.id)).toEqual(["c", "d"]);
    expect(buildVisibleEmployeeFlow(graph, new Set(["a", "b"])).visibleIds).toEqual(new Set(["a", "b", "c", "d"]));
    expect(graph.issues).toContainEqual({ employee: expect.objectContaining({ id: "a" }), message: "Reporting cycle was broken here so every employee remains visible." });
  });

  it("saves both reporting links", () => {
    expect(hierarchyReportingPayload("line-manager-1", "manager-1")).toEqual({ lineManagerId: "line-manager-1", managerId: "manager-1" });
    expect(hierarchyReportingPayload("", "")).toEqual({ lineManagerId: null, managerId: null });
  });
});
