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
  member?: RoleHierarchyMember;
  members: RoleHierarchyMember[];
  children: RoleHierarchyBranch[];
};

export type RoleHierarchyDepartment = {
  id: string;
  name: string;
  memberCount: number;
  branches: RoleHierarchyBranch[];
};

export type CompanyRoleHierarchy = {
  activeEmployees: RoleHierarchyMember[];
  executives: Array<{ id: string; code: "COO" | "CPO"; label: string; members: RoleHierarchyMember[] }>;
  departments: RoleHierarchyDepartment[];
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

type ReportingDraft = {
  member: RoleHierarchyMember;
  code: "MANAGER" | "LINE_MANAGER";
  employees: RoleHierarchyMember[];
};

export function buildCompanyRoleHierarchy(employees: EmployeeRecord[]): CompanyRoleHierarchy {
  const activeRecords = employees.filter(employee => employee.status === "Active" || employee.status === "On Leave");
  const activeEmployees = activeRecords.map(member).sort(compareMembers);
  const memberByCode = new Map(activeEmployees.map(employee => [employee.employeeCode.toLocaleLowerCase(), employee]));
  const executiveById = new Map<string, "COO" | "CPO">();
  activeEmployees.forEach(employee => {
    const role = executiveRole(employee);
    if (role) executiveById.set(employee.id, role);
  });

  const resolve = (value: string, employeeId: string) => {
    const reference = memberByCode.get(employeeCode(value));
    return reference && reference.id !== employeeId && !executiveById.has(reference.id) ? reference : undefined;
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

  const executives = (["COO", "CPO"] as const).map(code => ({
    id: `company-${code.toLocaleLowerCase()}`,
    code,
    label: roleLabels[code],
    members: activeEmployees.filter(employee => executiveById.get(employee.id) === code),
  }));
  const recordById = new Map(activeRecords.map(employee => [employee.id, employee]));
  const departmentMembers = new Map<string, RoleHierarchyMember[]>();
  activeEmployees.filter(employee => !executiveById.has(employee.id)).forEach(employee => {
    departmentMembers.set(employee.department, [...(departmentMembers.get(employee.department) ?? []), employee]);
  });

  const departments = [...departmentMembers.entries()]
    .sort(([left], [right]) => left === "Department not assigned" ? 1 : right === "Department not assigned" ? -1 : left.localeCompare(right))
    .map(([name, members], departmentIndex): RoleHierarchyDepartment => {
      const id = `department-${departmentIndex}`;
      const reportingPeople = new Map<string, ReportingDraft>();
      const parentById = new Map<string, string>();
      const directEmployees: RoleHierarchyMember[] = [];
      const ensureReportingPerson = (person: RoleHierarchyMember) => {
        const existing = reportingPeople.get(person.id);
        if (existing) return existing;
        // A person with both references is still one person in the tree; their direct reports stay under that one node.
        const created: ReportingDraft = {
          member: person,
          code: managerIds.has(person.id) ? "MANAGER" : "LINE_MANAGER",
          employees: [],
        };
        reportingPeople.set(person.id, created);
        return created;
      };
      const reportingParent = (record: EmployeeRecord) => {
        const manager = managerFor(record);
        const lineManager = lineManagerFor(record);
        return lineManager && lineManager.id !== manager?.id ? lineManager : manager;
      };
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
        ensureReportingPerson(parent);
        parentById.set(childId, parent.id);
      };

      // Include local role holders and referenced leaders, including leaders who belong to another department.
      members.forEach(employee => {
        const record = recordById.get(employee.id)!;
        if (managerIds.has(employee.id) || lineManagerIds.has(employee.id)) ensureReportingPerson(employee);
        const manager = managerFor(record);
        const lineManager = lineManagerFor(record);
        if (manager) ensureReportingPerson(manager);
        if (lineManager) ensureReportingPerson(lineManager);
      });

      // A line manager connects to the manager saved on that line manager's own record.
      [...reportingPeople.values()].forEach(({ member: person }) => {
        const record = recordById.get(person.id);
        if (record) setParent(person.id, reportingParent(record));
      });

      // Older data can specify the manager only on a shared report. Infer that one link when unambiguous.
      members.forEach(employee => {
        const record = recordById.get(employee.id)!;
        const manager = managerFor(record);
        const lineManager = lineManagerFor(record);
        if (!manager || !lineManager || manager.id === lineManager.id || parentById.has(lineManager.id)) return;
        setParent(lineManager.id, manager);
      });

      members.forEach(employee => {
        if (reportingPeople.has(employee.id)) return;
        const parent = reportingParent(recordById.get(employee.id)!);
        if (parent) ensureReportingPerson(parent).employees.push(employee);
        else directEmployees.push(employee);
      });

      const employeeBranch = (branchId: string, branchMembers: RoleHierarchyMember[]): RoleHierarchyBranch => ({
        id: branchId,
        code: "EMPLOYEE",
        label: roleLabels.EMPLOYEE,
        members: branchMembers.sort(compareMembers),
        children: [],
      });
      const childrenById = new Map<string, string[]>();
      parentById.forEach((parentId, childId) => {
        childrenById.set(parentId, [...(childrenById.get(parentId) ?? []), childId]);
      });
      const reportingBranch = (personId: string): RoleHierarchyBranch => {
        const draft = reportingPeople.get(personId)!;
        const branchId = `${id}-${draft.code.toLocaleLowerCase().replace("_", "-")}-${personId}`;
        return {
          id: branchId,
          code: draft.code,
          label: roleLabels[draft.code],
          member: draft.member,
          members: [],
          children: [
            ...(childrenById.get(personId) ?? []).sort((left, right) => compareMembers(reportingPeople.get(left)!.member, reportingPeople.get(right)!.member)).map(reportingBranch),
            ...(draft.employees.length ? [employeeBranch(`${branchId}-employees`, draft.employees)] : []),
          ],
        };
      };
      const reportingBranches = [...reportingPeople.values()]
        .filter(({ member: person }) => !parentById.has(person.id))
        .sort((left, right) => compareMembers(left.member, right.member))
        .map(({ member: person }) => reportingBranch(person.id));
      return {
        id,
        name,
        memberCount: members.length,
        branches: [...reportingBranches, ...(directEmployees.length ? [employeeBranch(`${id}-employees`, directEmployees)] : [])],
      };
    });

  const nonExecutives = activeEmployees.filter(employee => !executiveById.has(employee.id));
  return {
    activeEmployees,
    executives,
    departments,
    managerCount: nonExecutives.filter(employee => managerIds.has(employee.id)).length,
    lineManagerCount: nonExecutives.filter(employee => lineManagerIds.has(employee.id)).length,
    employeeCount: nonExecutives.filter(employee => !managerIds.has(employee.id) && !lineManagerIds.has(employee.id)).length,
  };
}
