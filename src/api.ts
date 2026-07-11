import {
  employeeImportColumns,
  normalizeEmployee,
  type EmployeeRecord,
  type EmployeeStatus,
  type HrState,
  type LeaveStatus,
  type PayrollSlip
} from "./data";

const env = import.meta as unknown as { env?: { VITE_API_URL?: string } };

export const apiBaseUrl = (env.env?.VITE_API_URL || "/api/v1").replace(/\/$/, "");
export const backendSessionKey = "medtech-hr-erp-backend-session-v1";

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  meta?: unknown;
  message?: string;
};

export type BackendSession = {
  email: string;
  token: string;
  csrfToken: string;
  role: string;
  stateUpdatedAt?: string;
};

type BackendDepartment = {
  id: string;
  name: string;
  code: string;
};

type BackendEmployee = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  address?: string | null;
  hireDate: string;
  employmentStatus: string;
  salary: string | number;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  department?: BackendDepartment | null;
  position?: { title: string; code: string } | null;
  manager?: Pick<BackendEmployee, "employeeCode" | "firstName" | "lastName"> | null;
};

type BackendLeave = {
  id: string;
  employeeId: string;
  startDate: string;
  endDate: string;
  totalDays: string | number;
  reason?: string | null;
  status: string;
  createdAt: string;
  approvedAt?: string | null;
  leaveType?: { name: string } | null;
};

type BackendPayroll = {
  id: string;
  employeeId: string;
  year: number;
  month: number;
  baseSalary: string | number;
  allowances: string | number;
  deductions: string | number;
  bonuses: string | number;
  grossPay: string | number;
  netPay: string | number;
  status: string;
};

type BackendConsoleState = {
  id: string;
  data: Partial<HrState>;
  updatedAt: string;
};

export function loadBackendSession(): BackendSession | null {
  try {
    const raw = sessionStorage.getItem(backendSessionKey) || localStorage.getItem(backendSessionKey);
    localStorage.removeItem(backendSessionKey);
    const session = raw ? JSON.parse(raw) as Partial<BackendSession> : null;
    return session?.token && session?.csrfToken && session.email && session.role ? session as BackendSession : null;
  } catch {
    return null;
  }
}

export async function loginBackend(email: string, password: string): Promise<BackendSession> {
  const result = await apiRequest<{ accessToken: string; csrfToken: string; user: { email: string; role: string } }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  return { email: result.user.email, role: result.user.role, token: result.accessToken, csrfToken: result.csrfToken };
}

export async function loadBackendState(current: HrState, session: BackendSession): Promise<{ state: HrState; updatedAt?: string }> {
  const consoleState = await loadBackendConsoleState(session.token);
  if (consoleState?.data) return { state: { ...current, ...consoleState.data }, updatedAt: consoleState.updatedAt };

  const [employees, departments, leaves, payroll] = await Promise.all([
    apiList<BackendEmployee>("/employees?limit=200", session.token),
    apiList<BackendDepartment>("/departments?limit=200", session.token),
    apiList<BackendLeave>("/leave/requests?limit=200", session.token),
    apiList<BackendPayroll>("/payroll?limit=200", session.token)
  ]);

  const departmentNames = departments.map(item => item.name).filter(Boolean);
  return {
    state: {
    ...current,
    employees: employees.map(mapEmployee),
    leaves: leaves.map(mapLeave),
    payroll: payroll.map(mapPayroll),
    settings: {
      ...current.settings,
      departments: departmentNames.length ? departmentNames : current.settings.departments
    }
    }
  };
}

export async function loadBackendConsoleState(token: string) {
  return apiRequest<BackendConsoleState | null>("/console-state", { token });
}

export async function saveBackendState(state: HrState, session: BackendSession) {
  return apiRequest<BackendConsoleState>("/console-state", {
    method: "PUT",
    token: session.token,
    csrfToken: session.csrfToken,
    body: JSON.stringify({ data: state, updatedAt: session.stateUpdatedAt })
  });
}

export async function generateBackendPayroll(session: BackendSession, year: number, month: number) {
  return apiRequest<BackendPayroll[]>("/payroll/generate", {
    method: "POST",
    token: session.token,
    csrfToken: session.csrfToken,
    body: JSON.stringify({ year, month })
  });
}

export async function logoutBackend(session: BackendSession) {
  return apiRequest<{ loggedOut: boolean }>("/auth/logout", {
    method: "POST",
    token: session.token,
    csrfToken: session.csrfToken
  });
}

async function apiList<T>(path: string, token: string) {
  return apiRequest<T[]>(path, { token });
}

async function apiRequest<T>(path: string, init: RequestInit & { token?: string; csrfToken?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (init.csrfToken) headers.set("X-CSRF-Token", init.csrfToken);

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });
  let payload: Partial<ApiEnvelope<T>> | undefined;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok || payload?.success === false) {
    throw new Error(payload?.message || `API request failed (${response.status})`);
  }

  return (payload && "data" in payload ? payload.data : payload) as T;
}

function mapEmployee(employee: BackendEmployee): EmployeeRecord {
  const fields = Object.fromEntries(employeeImportColumns.map(column => [column, ""]));
  const salary = String(Number(employee.salary || 0));
  const manager = employee.manager
    ? `${employee.manager.employeeCode} - ${employee.manager.firstName} ${employee.manager.lastName}`.trim()
    : "";

  return normalizeEmployee({
    id: employee.id,
    status: mapEmployeeStatus(employee.employmentStatus),
    fields: {
      ...fields,
      "Employee Code": employee.employeeCode,
      "Employee Category": "Staff",
      "First Name": employee.firstName,
      "Last Name": employee.lastName,
      "Full Name": `${employee.firstName} ${employee.lastName}`.trim(),
      Company: "MedTech Corporation Trading W.L.L.",
      "Working Company Name": "MedTech Corporation Trading W.L.L.",
      Department: employee.department?.name || "",
      Designation: employee.position?.title || "",
      "Date of Birth": dateOnly(employee.dateOfBirth),
      Gender: titleCase(employee.gender),
      "Joining Date": dateOnly(employee.hireDate),
      "Reporting Manager Employee Code/Name": manager,
      "Personal Mobile No.": employee.phone || "",
      "E-Mail ID (Work)": employee.email,
      "Emergency Contact Name": employee.emergencyContactName || "",
      "Emergency Contact Mobile No.": employee.emergencyContactPhone || "",
      Basic: salary,
      Total: salary
    }
  });
}

function mapLeave(leave: BackendLeave): HrState["leaves"][number] {
  return {
    id: leave.id,
    employeeId: leave.employeeId,
    type: leave.leaveType?.name || "Leave",
    from: dateOnly(leave.startDate),
    to: dateOnly(leave.endDate),
    days: Number(leave.totalDays || 0),
    reason: leave.reason || "",
    status: mapLeaveStatus(leave.status),
    appliedOn: dateOnly(leave.createdAt),
    decidedOn: dateOnly(leave.approvedAt)
  };
}

function mapPayroll(item: BackendPayroll): PayrollSlip {
  const base = Number(item.baseSalary || 0);
  const allowances = Number(item.allowances || 0);
  const deductions = Number(item.deductions || 0);
  const bonus = Number(item.bonuses || 0);
  return {
    id: item.id,
    employeeId: item.employeeId,
    year: item.year,
    month: item.month,
    basic: base,
    housing: 0,
    allowances,
    overtime: 0,
    bonus,
    deductions,
    lopDays: 0,
    lopAmount: 0,
    gross: Number(item.grossPay || base + allowances + bonus),
    net: Number(item.netPay || 0),
    note: "Synced from backend",
    status: item.status === "PAID" || item.status === "APPROVED" ? "Finalized" : "Draft"
  };
}

function mapEmployeeStatus(value: string): EmployeeStatus {
  if (value === "ON_LEAVE") return "On Leave";
  if (value === "TERMINATED") return "Terminated";
  if (value === "RESIGNED") return "Resigned";
  return "Active";
}

function mapLeaveStatus(value: string): LeaveStatus {
  if (value === "APPROVED") return "Approved";
  if (value === "REJECTED" || value === "CANCELLED") return "Rejected";
  return "Pending";
}

function dateOnly(value?: string | null) {
  return value ? value.slice(0, 10) : "";
}

function titleCase(value?: string | null) {
  return value ? value.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase()) : "";
}
