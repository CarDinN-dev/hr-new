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

export type DepartmentRoleGroup = {
  id: string;
  code: string;
  label: string;
  members: RoleHierarchyMember[];
};

export type RoleHierarchyDepartment = {
  id: string;
  name: string;
  memberCount: number;
  roles: DepartmentRoleGroup[];
};

export type CompanyRoleHierarchy = {
  activeEmployees: RoleHierarchyMember[];
  executives: Array<{ code: "COO" | "CPO"; label: string; members: RoleHierarchyMember[] }>;
  departments: RoleHierarchyDepartment[];
  roleAssignmentCount: number;
  unassignedCount: number;
};

const roleLabels: Record<string, string> = {
  COO: "Chief Operating Officer",
  CPO: "Chief People Officer",
  HR: "Human Resources",
  MANAGER: "Manager",
  LINE_MANAGER: "Line Manager",
  EMPLOYEE: "Employee",
  ADMIN: "Administrator",
  SUPER_ADMIN: "Super Administrator",
  NO_ACCESS_ROLE: "No access role assigned",
};

const roleOrder = ["HR", "MANAGER", "LINE_MANAGER", "EMPLOYEE", "ADMIN", "SUPER_ADMIN", "NO_ACCESS_ROLE"];

export function accessRoleLabel(code: string) {
  return roleLabels[code] ?? code.toLocaleLowerCase().split("_").filter(Boolean).map(word => word.charAt(0).toLocaleUpperCase() + word.slice(1)).join(" ");
}

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

function compareMembers(left: RoleHierarchyMember, right: RoleHierarchyMember) {
  return left.name.localeCompare(right.name) || left.employeeCode.localeCompare(right.employeeCode);
}

function compareRoles(left: DepartmentRoleGroup, right: DepartmentRoleGroup) {
  const leftIndex = roleOrder.indexOf(left.code);
  const rightIndex = roleOrder.indexOf(right.code);
  return (leftIndex < 0 ? roleOrder.length : leftIndex) - (rightIndex < 0 ? roleOrder.length : rightIndex)
    || left.label.localeCompare(right.label);
}

export function buildCompanyRoleHierarchy(employees: EmployeeRecord[]): CompanyRoleHierarchy {
  const activeEmployees = employees
    .filter(employee => employee.status === "Active" || employee.status === "On Leave")
    .map(member)
    .sort(compareMembers);
  const executiveById = new Map<string, "COO" | "CPO">();
  activeEmployees.forEach(employee => {
    const role = executiveRole(employee);
    if (role) executiveById.set(employee.id, role);
  });

  const executives = (["COO", "CPO"] as const).map(code => ({
    code,
    label: accessRoleLabel(code),
    members: activeEmployees.filter(employee => executiveById.get(employee.id) === code),
  }));
  const departmentMembers = new Map<string, RoleHierarchyMember[]>();
  activeEmployees.filter(employee => !executiveById.has(employee.id)).forEach(employee => {
    departmentMembers.set(employee.department, [...(departmentMembers.get(employee.department) ?? []), employee]);
  });

  const departments = [...departmentMembers.entries()]
    .sort(([left], [right]) => left === "Department not assigned" ? 1 : right === "Department not assigned" ? -1 : left.localeCompare(right))
    .map(([name, members], departmentIndex) => {
      const roles = new Map<string, RoleHierarchyMember[]>();
      members.forEach(employee => {
        const directRoles = employee.roleCodes.filter(code => code !== "COO" && code !== "CPO");
        (directRoles.length ? directRoles : ["NO_ACCESS_ROLE"]).forEach(code => roles.set(code, [...(roles.get(code) ?? []), employee]));
      });
      const id = `department-${departmentIndex}`;
      return {
        id,
        name,
        memberCount: members.length,
        roles: [...roles.entries()].map(([code, roleMembers], roleIndex) => ({
          id: `${id}-role-${roleIndex}`,
          code,
          label: accessRoleLabel(code),
          members: roleMembers.sort(compareMembers),
        })).sort(compareRoles),
      };
    });

  return {
    activeEmployees,
    executives,
    departments,
    roleAssignmentCount: departments.reduce((total, department) => total + department.roles.reduce((count, role) => count + role.members.length, 0), 0)
      + executives.reduce((total, group) => total + group.members.length, 0),
    unassignedCount: activeEmployees.filter(employee => employee.roleCodes.length === 0).length,
  };
}
