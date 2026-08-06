import type { EmployeeRecord } from "./data";

export type RoleHierarchyMember = {
  id: string;
  employeeCode: string;
  name: string;
  designation: string;
  department: string;
  status: EmployeeRecord["status"];
  roleCodes: string[];
};

export type RoleHierarchyBranch = {
  id: string;
  code: "MANAGER" | "LINE_MANAGER" | "EMPLOYEE";
  label: string;
  member: RoleHierarchyMember;
  reportingRoles: Array<"MANAGER" | "LINE_MANAGER">;
  children: RoleHierarchyBranch[];
};

export type RoleHierarchyDepartment = {
  id: string;
  name: string;
  memberCount: number;
  branches: RoleHierarchyBranch[];
};

export type RoleHierarchyExecutive = {
  id: string;
  code: "COO" | "CPO";
  label: string;
  members: RoleHierarchyMember[];
  departments: RoleHierarchyDepartment[];
};

export type CompanyRoleHierarchy = {
  activeEmployees: RoleHierarchyMember[];
  executives: RoleHierarchyExecutive[];
  unassignedDepartments: RoleHierarchyDepartment[];
  departmentCount: number;
  managerCount: number;
  lineManagerCount: number;
  employeeCount: number;
};

const roleLabels = {
  COO: "Chief Operating Officer",
  CPO: "Chief People Officer",
  MANAGER: "Manager",
  LINE_MANAGER: "Line Manager",
  EMPLOYEE: "Employee",
} as const;

function member(employee: EmployeeRecord): RoleHierarchyMember {
  const employeeCode = employee.fields["Employee Code"]?.trim() || "Code not assigned";
  return {
    id: employee.id,
    employeeCode,
    name: employee.fields["Full Name"]?.trim() || employeeCode,
    designation: employee.fields.Designation?.trim() || "Designation not assigned",
    department: employee.fields.Department?.trim() || "Department not assigned",
    status: employee.status,
    roleCodes: [...new Set((employee.roleCodes ?? []).map(code => code.trim()).filter(Boolean))],
  };
}

function executiveRole(employee: RoleHierarchyMember): "COO" | "CPO" | null {
  if (employee.roleCodes.includes("COO")) return "COO";
  if (employee.roleCodes.includes("CPO")) return "CPO";
  const designation = employee.designation.toLocaleUpperCase();
  if (designation === "COO" || designation.includes("CHIEF OPERATING OFFICER")) return "COO";
  if (designation === "CPO" || designation.includes("CHIEF PEOPLE OFFICER")) return "CPO";
  return null;
}

function employeeCode(value: string) {
  return value.split(" - ", 1)[0].trim().toLocaleLowerCase();
}

function compareMembers(left: RoleHierarchyMember, right: RoleHierarchyMember) {
  return left.name.localeCompare(right.name) || left.employeeCode.localeCompare(right.employeeCode);
}

export function buildCompanyRoleHierarchy(employees: EmployeeRecord[]): CompanyRoleHierarchy {
  const activeRecords = employees
    .filter(employee => employee.status === "Active" || employee.status === "On Leave")
    .sort((left, right) => (left.fields["Employee Code"] || left.id).localeCompare(right.fields["Employee Code"] || right.id));
  const activeEmployees = activeRecords.map(member).sort(compareMembers);
  const memberById = new Map(activeEmployees.map(employee => [employee.id, employee]));
  const memberByCode = new Map(activeEmployees.map(employee => [employee.employeeCode.toLocaleLowerCase(), employee]));
  const executiveById = new Map<string, "COO" | "CPO">();
  activeEmployees.forEach(employee => {
    const role = executiveRole(employee);
    if (role) executiveById.set(employee.id, role);
  });

  const resolve = (value: string, employeeId: string) => {
    const reference = memberByCode.get(employeeCode(value));
    return reference && reference.id !== employeeId ? reference : undefined;
  };
  const managerFor = (employee: EmployeeRecord) => resolve(employee.fields["Manager Employee Code/Name"] || "", employee.id);
  const lineManagerFor = (employee: EmployeeRecord) => resolve(employee.fields["Line Manager Employee Code/Name"] || employee.fields["Reporting Manager Employee Code/Name"] || "", employee.id);
  const managerIds = new Set<string>();
  const lineManagerIds = new Set<string>();
  activeRecords.forEach(employee => {
    const manager = managerFor(employee);
    const lineManager = lineManagerFor(employee);
    if (manager) managerIds.add(manager.id);
    if (lineManager) lineManagerIds.add(lineManager.id);
  });

  const parentById = new Map<string, string>();
  const createsCycle = (childId: string, parentId: string) => {
    const seen = new Set([childId]);
    let currentId: string | undefined = parentId;
    while (currentId) {
      if (seen.has(currentId)) return true;
      seen.add(currentId);
      currentId = parentById.get(currentId);
    }
    return false;
  };
  const setParent = (childId: string, parent: RoleHierarchyMember | undefined) => {
    if (!parent || parent.id === childId || createsCycle(childId, parent.id)) return;
    parentById.set(childId, parent.id);
  };
  const reportingParent = (record: EmployeeRecord) => {
    const manager = managerFor(record);
    const lineManager = lineManagerFor(record);
    return manager ?? lineManager;
  };

  activeRecords.forEach(record => {
    if (executiveById.get(record.id) === "COO") return;
    setParent(record.id, reportingParent(record));
  });

  // Older imports can store the Manager only on a shared report. Keep the one unambiguous bridge.
  activeRecords.forEach(record => {
    const manager = managerFor(record);
    const lineManager = lineManagerFor(record);
    if (!manager || !lineManager || manager.id === lineManager.id || parentById.has(lineManager.id)) return;
    setParent(lineManager.id, manager);
  });

  const childrenById = new Map<string, string[]>();
  const rootIdsByOwner = new Map<"COO" | "CPO" | "UNASSIGNED", string[]>([
    ["COO", []], ["CPO", []], ["UNASSIGNED", []],
  ]);
  activeEmployees.filter(employee => !executiveById.has(employee.id)).forEach(employee => {
    const parentId = parentById.get(employee.id);
    const parentExecutive = parentId ? executiveById.get(parentId) : undefined;
    if (parentExecutive) rootIdsByOwner.get(parentExecutive)!.push(employee.id);
    else if (parentId && memberById.has(parentId) && !executiveById.has(parentId)) {
      childrenById.set(parentId, [...(childrenById.get(parentId) ?? []), employee.id]);
    } else rootIdsByOwner.get("UNASSIGNED")!.push(employee.id);
  });

  const branchFor = (personId: string): RoleHierarchyBranch => {
    const person = memberById.get(personId)!;
    const reportingRoles: RoleHierarchyBranch["reportingRoles"] = [
      ...(managerIds.has(personId) ? ["MANAGER" as const] : []),
      ...(lineManagerIds.has(personId) ? ["LINE_MANAGER" as const] : []),
    ];
    const code = reportingRoles.includes("MANAGER") ? "MANAGER" : reportingRoles.includes("LINE_MANAGER") ? "LINE_MANAGER" : "EMPLOYEE";
    return {
      id: `reporting-${personId}`,
      code,
      label: reportingRoles.length === 2 ? "Manager / Line Manager" : roleLabels[code],
      member: person,
      reportingRoles,
      children: (childrenById.get(personId) ?? [])
        .sort((left, right) => compareMembers(memberById.get(left)!, memberById.get(right)!))
        .map(branchFor),
    };
  };

  const branchSize = (branch: RoleHierarchyBranch): number => 1 + branch.children.reduce((total, child) => total + branchSize(child), 0);
  const departmentsFor = (owner: "COO" | "CPO" | "UNASSIGNED") => {
    const grouped = new Map<string, RoleHierarchyBranch[]>();
    rootIdsByOwner.get(owner)!
      .sort((left, right) => compareMembers(memberById.get(left)!, memberById.get(right)!))
      .forEach(personId => {
        const branch = branchFor(personId);
        const department = branch.member.department;
        grouped.set(department, [...(grouped.get(department) ?? []), branch]);
      });
    return [...grouped.entries()]
      .sort(([left], [right]) => left === "Department not assigned" ? 1 : right === "Department not assigned" ? -1 : left.localeCompare(right))
      .map(([name, branches], index): RoleHierarchyDepartment => ({
        id: `${owner.toLocaleLowerCase()}-department-${index}`,
        name,
        memberCount: branches.reduce((total, branch) => total + branchSize(branch), 0),
        branches,
      }));
  };

  const executives = (["COO", "CPO"] as const).map(code => ({
    id: `company-${code.toLocaleLowerCase()}`,
    code,
    label: roleLabels[code],
    members: activeEmployees.filter(employee => executiveById.get(employee.id) === code),
    departments: departmentsFor(code),
  }));
  const unassignedDepartments = departmentsFor("UNASSIGNED");
  const nonExecutives = activeEmployees.filter(employee => !executiveById.has(employee.id));

  return {
    activeEmployees,
    executives,
    unassignedDepartments,
    departmentCount: new Set(nonExecutives.map(employee => employee.department)).size,
    managerCount: nonExecutives.filter(employee => managerIds.has(employee.id)).length,
    lineManagerCount: nonExecutives.filter(employee => lineManagerIds.has(employee.id)).length,
    employeeCount: nonExecutives.filter(employee => !managerIds.has(employee.id) && !lineManagerIds.has(employee.id)).length,
  };
}
