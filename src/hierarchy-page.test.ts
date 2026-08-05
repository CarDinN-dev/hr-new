import { describe, expect, it } from "vitest";
import { buildOrganizationHierarchy, hierarchyLineManagerCode, hierarchyManagerCode, hierarchyReportingPayload } from "./features/hierarchy-page";
import { buildCompanyRoleHierarchy, type RoleHierarchyBranch } from "./roleHierarchy";

const employee = (id: string, code: string, fields: Record<string, string> = {}, roleCodes: string[] = []) => ({
  id,
  status: "Active" as const,
  roleCodes,
  fields: { "Employee Code": code, "Full Name": id, Designation: "Specialist", ...fields },
});

const executive = (hierarchy: ReturnType<typeof buildCompanyRoleHierarchy>, code: "COO" | "CPO") => hierarchy.executives.find(item => item.code === code)!;
const department = (hierarchy: ReturnType<typeof buildCompanyRoleHierarchy>, owner: "COO" | "CPO", name: string) => executive(hierarchy, owner).departments.find(item => item.name === name)!;
const flatten = (branches: RoleHierarchyBranch[]): RoleHierarchyBranch[] => branches.flatMap(branch => [branch, ...flatten(branch.children)]);

describe("hierarchy page", () => {
  it("separates direct COO and CPO reports into executive-owned department branches", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("coo", "EX-001", { "Full Name": "Omar Operations", Designation: "Director" }, ["COO"]),
      employee("cpo", "EX-002", { "Full Name": "Priya People", Designation: "Chief People Officer", "Manager Employee Code/Name": "EX-001 - Omar Operations" }),
      employee("coo-report", "OPS-001", { "Full Name": "Morgan Operations", Department: "Operations", "Manager Employee Code/Name": "EX-001 - Omar Operations", "Line Manager Employee Code/Name": "EX-001 - Omar Operations" }),
      employee("cpo-report", "HR-001", { "Full Name": "Harper People", Department: "Human Resources", "Manager Employee Code/Name": "EX-002 - Priya People" }),
    ]);

    expect(hierarchy.executives.map(group => [group.code, group.members.map(member => member.name)])).toEqual([
      ["COO", ["Omar Operations"]],
      ["CPO", ["Priya People"]],
    ]);
    expect(department(hierarchy, "COO", "Operations").branches[0]).toMatchObject({ code: "EMPLOYEE", member: { id: "coo-report" } });
    expect(department(hierarchy, "CPO", "Human Resources").branches[0]).toMatchObject({ code: "EMPLOYEE", member: { id: "cpo-report" } });
    expect(hierarchy.unassignedDepartments).toEqual([]);
    expect(hierarchy.departmentCount).toBe(2);
  });

  it("connects named Manager, Line Manager, and individual Employee cards", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("coo", "EX-001", {}, ["COO"]),
      employee("manager", "MGR-001", { "Full Name": "Amy Manager", Department: "Engineering", "Manager Employee Code/Name": "EX-001 - coo" }),
      employee("line", "LINE-001", { "Full Name": "Leo Lead", Department: "Engineering", "Manager Employee Code/Name": "MGR-001 - Amy Manager" }),
      employee("engineer", "EN-001", { "Full Name": "Ben Engineer", Department: "Engineering", "Manager Employee Code/Name": "MGR-001 - Amy Manager", "Line Manager Employee Code/Name": "LINE-001 - Leo Lead" }),
      employee("manager-direct", "EN-002", { "Full Name": "Cara Engineer", Department: "Engineering", "Manager Employee Code/Name": "MGR-001 - Amy Manager" }),
    ]);

    const manager = department(hierarchy, "COO", "Engineering").branches[0];
    expect(manager).toMatchObject({ code: "MANAGER", member: { id: "manager" } });
    expect(manager.children.map(branch => branch.member.id)).toEqual(["manager-direct", "line"]);
    expect(manager.children[0]).toMatchObject({ code: "EMPLOYEE", member: { id: "manager-direct" }, children: [] });
    expect(manager.children[1]).toMatchObject({ code: "LINE_MANAGER", member: { id: "line" } });
    expect(manager.children[1].children[0]).toMatchObject({ code: "EMPLOYEE", member: { id: "engineer" }, children: [] });
    expect(hierarchy).toMatchObject({ managerCount: 1, lineManagerCount: 1, employeeCount: 2 });
  });

  it("keeps manager-only, line-manager-only, legacy, invalid, and missing references visible", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("manager", "MGR-01", { Department: "Operations" }),
      employee("line", "LINE-01", { Department: "Operations" }),
      employee("both", "EMP-01", { Department: "Operations", "Manager Employee Code/Name": "MGR-01 - manager", "Line Manager Employee Code/Name": "LINE-01 - line" }),
      employee("manager-only", "EMP-02", { Department: "Operations", "Manager Employee Code/Name": "MGR-01 - manager" }),
      employee("line-only", "EMP-03", { Department: "Operations", "Line Manager Employee Code/Name": "LINE-01 - line" }),
      employee("legacy", "EMP-04", { Department: "Operations", "Reporting Manager Employee Code/Name": "LINE-01 - line" }),
      employee("missing", "EMP-05", { Department: "Operations", "Manager Employee Code/Name": "UNKNOWN", "Line Manager Employee Code/Name": "MISSING" }),
    ]);

    const operations = hierarchy.unassignedDepartments[0];
    const manager = operations.branches.find(branch => branch.member.id === "manager")!;
    expect(manager.children.map(branch => branch.member.id)).toEqual(["line", "manager-only"]);
    expect(manager.children.find(branch => branch.member.id === "line")!.children.map(branch => branch.member.id)).toEqual(["both", "legacy", "line-only"]);
    expect(operations.branches.find(branch => branch.member.id === "missing")).toMatchObject({ code: "EMPLOYEE" });
    expect(flatten(operations.branches).map(branch => branch.member.id).sort()).toEqual(["both", "legacy", "line", "line-only", "manager", "manager-only", "missing"].sort());
  });

  it("renders a dual-capacity leader once and ignores access roles for reporting placement", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("hybrid", "LEAD-001", { "Full Name": "Hybrid Lead", Department: "Operations" }, ["ADMIN"]),
      employee("manager-report", "EMP-001", { Department: "Operations", "Manager Employee Code/Name": "LEAD-001 - Hybrid Lead" }),
      { ...employee("line-report", "EMP-002", { Department: "Operations", "Line Manager Employee Code/Name": "LEAD-001 - Hybrid Lead" }, ["SUPER_ADMIN"]), status: "On Leave" as const },
      { ...employee("former", "EMP-003", { Department: "Operations", "Manager Employee Code/Name": "LEAD-001 - Hybrid Lead" }), status: "Resigned" as const },
    ]);

    const branches = flatten(hierarchy.unassignedDepartments[0].branches);
    const hybrid = branches.filter(branch => branch.member.id === "hybrid");
    expect(hybrid).toHaveLength(1);
    expect(hybrid[0]).toMatchObject({ label: "Manager / Line Manager", reportingRoles: ["MANAGER", "LINE_MANAGER"] });
    expect(hybrid[0].children.map(branch => branch.member.id)).toEqual(["line-report", "manager-report"]);
    expect(branches.find(branch => branch.member.id === "line-report")?.member.status).toBe("On Leave");
    expect(hierarchy.activeEmployees.map(member => member.id)).not.toContain("former");
    expect(hierarchy).toMatchObject({ managerCount: 1, lineManagerCount: 1, employeeCount: 2 });
  });

  it("keeps cross-department descendants in one reporting tree without duplication", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("coo", "COO-01", {}, ["COO"]),
      employee("manager", "MGR-01", { Department: "Operations", "Manager Employee Code/Name": "COO-01 - coo" }),
      employee("finance", "FIN-01", { Department: "Finance", "Manager Employee Code/Name": "MGR-01 - manager" }),
    ]);

    const operations = department(hierarchy, "COO", "Operations");
    expect(operations.memberCount).toBe(2);
    expect(operations.branches[0].children[0].member).toMatchObject({ id: "finance", department: "Finance" });
    expect(executive(hierarchy, "COO").departments.map(item => item.name)).toEqual(["Operations"]);
    expect(flatten(operations.branches).filter(branch => branch.member.id === "finance")).toHaveLength(1);
  });

  it("breaks reporting cycles into the unassigned section without hiding anyone", () => {
    const hierarchy = buildCompanyRoleHierarchy([
      employee("a", "A", { Department: "Operations", "Manager Employee Code/Name": "B - b" }),
      employee("b", "B", { Department: "Operations", "Line Manager Employee Code/Name": "A - a" }),
    ]);
    const ids = flatten(hierarchy.unassignedDepartments[0].branches).map(branch => branch.member.id);
    expect(ids.sort()).toEqual(["a", "b"]);
    expect(new Set(ids).size).toBe(2);
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
    const record = { id: "employee-1", status: "Active" as const, fields: {
      Designation: "Employee", "Line Manager Employee Code/Name": "LINE-01 - Lina Lead", "Manager Employee Code/Name": "MGR-01 - Dana Manager",
    } };
    expect(hierarchyLineManagerCode(record)).toBe("line-01");
    expect(hierarchyManagerCode(record)).toBe("mgr-01");
    const legacyEmployee = { id: "employee-2", status: "Active" as const, fields: { "Reporting Manager Employee Code/Name": "LINE-02 - Legacy Lead" } };
    expect(hierarchyLineManagerCode(legacyEmployee)).toBe("line-02");
    expect(hierarchyManagerCode(legacyEmployee)).toBe("");
  });

  it("shows combined reporting roles and keeps every employee visible when an organizational cycle exists", () => {
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

  it("shows active executive and HR roles without changing organizational placement", () => {
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
