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

type LineManagerDraft = { member: RoleHierarchyMember; employees: RoleHierarchyMember[] };
type ManagerDraft = { member: RoleHierarchyMember; lineManagers: Map<string, LineManagerDraft>; employees: RoleHierarchyMember[] };

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
      const managers = new Map<string, ManagerDraft>();
      const lineManagers = new Map<string, LineManagerDraft>();
      const directEmployees: RoleHierarchyMember[] = [];
      const ensureManager = (manager: RoleHierarchyMember) => {
        const existing = managers.get(manager.id);
        if (existing) return existing;
        const created = { member: manager, lineManagers: new Map<string, LineManagerDraft>(), employees: [] };
        managers.set(manager.id, created);
        return created;
      };
      const ensureLineManager = (collection: Map<string, LineManagerDraft>, lineManager: RoleHierarchyMember) => {
        const existing = collection.get(lineManager.id);
        if (existing) return existing;
        const created = { member: lineManager, employees: [] };
        collection.set(lineManager.id, created);
        return created;
      };

      members.forEach(employee => {
        if (managerIds.has(employee.id) || lineManagerIds.has(employee.id)) return;
        const record = recordById.get(employee.id)!;
        const manager = managerFor(record);
        const lineManager = lineManagerFor(record);
        if (manager && lineManager) ensureLineManager(ensureManager(manager).lineManagers, lineManager).employees.push(employee);
        else if (manager) ensureManager(manager).employees.push(employee);
        else if (lineManager) ensureLineManager(lineManagers, lineManager).employees.push(employee);
        else directEmployees.push(employee);
      });

      // Keep referenced role holders visible in their own department even when their reports sit elsewhere.
      members.forEach(employee => {
        if (managerIds.has(employee.id)) ensureManager(employee);
        if (lineManagerIds.has(employee.id) && ![...managers.values()].some(manager => manager.lineManagers.has(employee.id))) ensureLineManager(lineManagers, employee);
      });

      const employeeBranch = (branchId: string, branchMembers: RoleHierarchyMember[]): RoleHierarchyBranch => ({
        id: branchId,
        code: "EMPLOYEE",
        label: roleLabels.EMPLOYEE,
        members: branchMembers.sort(compareMembers),
        children: [],
      });
      const lineManagerBranch = (branchId: string, draft: LineManagerDraft): RoleHierarchyBranch => ({
        id: branchId,
        code: "LINE_MANAGER",
        label: roleLabels.LINE_MANAGER,
        member: draft.member,
        members: [],
        children: draft.employees.length ? [employeeBranch(`${branchId}-employees`, draft.employees)] : [],
      });
      const managerBranches = [...managers.values()].sort((left, right) => compareMembers(left.member, right.member)).map(draft => {
        const branchId = `${id}-manager-${draft.member.id}`;
        return {
          id: branchId,
          code: "MANAGER" as const,
          label: roleLabels.MANAGER,
          member: draft.member,
          members: [],
          children: [
            ...[...draft.lineManagers.values()].sort((left, right) => compareMembers(left.member, right.member)).map(lineManager => lineManagerBranch(`${branchId}-line-manager-${lineManager.member.id}`, lineManager)),
            ...(draft.employees.length ? [employeeBranch(`${branchId}-employees`, draft.employees)] : []),
          ],
        };
      });
      const lineManagerBranches = [...lineManagers.values()].sort((left, right) => compareMembers(left.member, right.member)).map(draft => lineManagerBranch(`${id}-line-manager-${draft.member.id}`, draft));
      return {
        id,
        name,
        memberCount: members.length,
        branches: [...managerBranches, ...lineManagerBranches, ...(directEmployees.length ? [employeeBranch(`${id}-employees`, directEmployees)] : [])],
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
