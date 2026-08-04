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

export type DepartmentReportingLevel = {
  id: string;
  code: "MANAGER" | "LINE_MANAGER" | "EMPLOYEE";
  label: string;
  members: RoleHierarchyMember[];
};

export type RoleHierarchyDepartment = {
  id: string;
  name: string;
  memberCount: number;
  levels: DepartmentReportingLevel[];
};

export type CompanyRoleHierarchy = {
  activeEmployees: RoleHierarchyMember[];
  executives: Array<{ code: "COO" | "CPO"; label: string; members: RoleHierarchyMember[] }>;
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

export function buildCompanyRoleHierarchy(employees: EmployeeRecord[]): CompanyRoleHierarchy {
  const activeRecords = employees.filter(employee => employee.status === "Active" || employee.status === "On Leave");
  const activeEmployees = activeRecords.map(member).sort(compareMembers);
  const memberByCode = new Map(activeEmployees.map(employee => [employee.employeeCode.toLocaleLowerCase(), employee]));
  const executiveById = new Map<string, "COO" | "CPO">();
  activeEmployees.forEach(employee => {
    const role = executiveRole(employee);
    if (role) executiveById.set(employee.id, role);
  });

  const managerIds = new Set<string>();
  const lineManagerIds = new Set<string>();
  activeRecords.forEach(employee => {
    const manager = memberByCode.get(employeeCode(employee.fields["Manager Employee Code/Name"] || ""));
    const lineManager = memberByCode.get(employeeCode(employee.fields["Line Manager Employee Code/Name"] || employee.fields["Reporting Manager Employee Code/Name"] || ""));
    if (manager && manager.id !== employee.id) managerIds.add(manager.id);
    if (lineManager && lineManager.id !== employee.id) lineManagerIds.add(lineManager.id);
  });

  const executives = (["COO", "CPO"] as const).map(code => ({
    code,
    label: roleLabels[code],
    members: activeEmployees.filter(employee => executiveById.get(employee.id) === code),
  }));
  const departmentMembers = new Map<string, RoleHierarchyMember[]>();
  activeEmployees.filter(employee => !executiveById.has(employee.id)).forEach(employee => {
    departmentMembers.set(employee.department, [...(departmentMembers.get(employee.department) ?? []), employee]);
  });

  const departments = [...departmentMembers.entries()]
    .sort(([left], [right]) => left === "Department not assigned" ? 1 : right === "Department not assigned" ? -1 : left.localeCompare(right))
    .map(([name, members], departmentIndex) => {
      const id = `department-${departmentIndex}`;
      const level = (code: DepartmentReportingLevel["code"], levelMembers: RoleHierarchyMember[], index: number): DepartmentReportingLevel => ({
        id: `${id}-level-${index}`,
        code,
        label: roleLabels[code],
        members: levelMembers.sort(compareMembers),
      });
      return {
        id,
        name,
        memberCount: members.length,
        levels: [
          level("MANAGER", members.filter(employee => managerIds.has(employee.id)), 0),
          level("LINE_MANAGER", members.filter(employee => lineManagerIds.has(employee.id)), 1),
          level("EMPLOYEE", members.filter(employee => !managerIds.has(employee.id) && !lineManagerIds.has(employee.id)), 2),
        ],
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
