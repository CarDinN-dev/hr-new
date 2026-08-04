import { describe, expect, it } from "vitest";
import { buildOrganizationHierarchy, hierarchyLineManagerCode, hierarchyManagerCode, hierarchyReportingPayload } from "./features/hierarchy-page";
import { buildCompanyRoleHierarchy } from "./roleHierarchy";

const employee = (id: string, code: string, fields: Record<string, string> = {}, roleCodes: string[] = []) => ({
  id,
  status: "Active" as const,
  roleCodes,
  fields: { "Employee Code": code, "Full Name": id, Designation: "Specialist", ...fields },
});

describe("hierarchy page", () => {
  it("places COO and CPO above department reporting levels", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("coo", "EX-001", { "Full Name": "Omar Operations", Designation: "Director" }, ["COO"]),
      employee("cpo", "EX-002", { "Full Name": "Priya People", Designation: "Chief People Officer" }),
      employee("manager", "MGR-001", { "Full Name": "Amy Manager", Department: "Engineering" }, ["SUPER_ADMIN"]),
      employee("line", "LINE-001", { "Full Name": "Leo Lead", Department: "Engineering", "Manager Employee Code/Name": "MGR-001 - Amy Manager" }),
      employee("engineer", "EN-001", { "Full Name": "Ben Engineer", Department: "Engineering", "Manager Employee Code/Name": "MGR-001 - Amy Manager", "Line Manager Employee Code/Name": "LINE-001 - Leo Lead" }, ["CUSTOM_ACCESS_ROLE"]),
    ]);

    expect(hierarchy.executives.map(group => [group.code, group.members.map(member => member.name)])).toEqual([
      ["COO", ["Omar Operations"]],
      ["CPO", ["Priya People"]],
    ]);
    expect(hierarchy.departments.map(department => department.name)).toEqual(["Engineering"]);
    expect(hierarchy.departments[0].levels.map(level => [level.code, level.members.map(member => member.name)])).toEqual([
      ["MANAGER", ["Amy Manager"]],
      ["LINE_MANAGER", ["Leo Lead"]],
      ["EMPLOYEE", ["Ben Engineer"]],
    ]);
    expect(hierarchy).toMatchObject({ managerCount: 1, lineManagerCount: 1, employeeCount: 1 });
  });

  it("uses saved reporting assignments instead of access roles", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("hybrid", "LEAD-001", { "Full Name": "Hybrid Lead", Department: "Operations" }, ["ADMIN"]),
      employee("manager-report", "EMP-001", { Department: "Operations", "Manager Employee Code/Name": "LEAD-001 - Hybrid Lead" }),
      employee("line-report", "EMP-002", { Department: "Operations", "Line Manager Employee Code/Name": "LEAD-001 - Hybrid Lead" }),
      employee("fallback", "EMP-003", { "Full Name": "", Department: "", Designation: "", "Manager Employee Code/Name": "MISSING - Missing" }, ["SUPER_ADMIN"]),
      { ...employee("former", "EMP-004", { Department: "Finance", "Manager Employee Code/Name": "LEAD-001 - Hybrid Lead" }), status: "Resigned" as const },
    ]);

    const operations = hierarchy.departments[0];
    expect(operations.levels[0].members.map(member => member.id)).toEqual(["hybrid"]);
    expect(operations.levels[1].members.map(member => member.id)).toEqual(["hybrid"]);
    expect(operations.levels[2].members.map(member => member.id)).toEqual(["line-report", "manager-report"]);
    expect(hierarchy.departments[1]).toMatchObject({ name: "Department not assigned", memberCount: 1 });
    expect(hierarchy.departments[1].levels[2].members[0]).toMatchObject({ name: "EMP-003", designation: "Designation not assigned" });
    expect(hierarchy.activeEmployees.map(member => member.id)).not.toContain("former");
    expect(hierarchy).toMatchObject({ managerCount: 1, lineManagerCount: 1, employeeCount: 3 });
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
