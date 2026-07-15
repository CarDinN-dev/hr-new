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

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export type BackendSession = {
  id: string;
  email: string;
  csrfToken: string;
  role: string;
  sessionVersion: number;
  stateUpdatedAt?: string;
};

type BackendSessionResponse = {
  csrfToken: string;
  user: { id: string; email: string; role: string; sessionVersion: number };
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

export type BackendConsoleState = {
  id: string;
  data: Partial<HrState>;
  updatedAt: string;
};

export type BackendBackupStatus = {
  count: number;
  intervalHours: number;
  latest: { id: string; kind: string; createdAt: string } | null;
};

export function loadBackendSession(): BackendSession | null {
  try {
    const raw = sessionStorage.getItem(backendSessionKey) || localStorage.getItem(backendSessionKey);
    localStorage.removeItem(backendSessionKey);
    const session = raw ? JSON.parse(raw) as Partial<BackendSession> : null;
    return session?.id && session?.csrfToken && session.email && Number.isInteger(session.sessionVersion) && isHrConsoleRole(session.role)
      ? session as BackendSession
      : null;
  } catch {
    return null;
  }
}

export async function loginBackend(email: string, password: string): Promise<BackendSession> {
  const result = await apiRequest<BackendSessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });
  return backendSession(result);
}

export async function restoreBackendSession(): Promise<BackendSession | null> {
  try {
    return backendSession(await apiRequest<BackendSessionResponse>("/auth/me"));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

export function startMicrosoftLogin() {
  window.location.assign(`${apiBaseUrl}/auth/microsoft/start`);
}

function backendSession(result: BackendSessionResponse): BackendSession {
  if (!isHrConsoleRole(result.user.role)) {
    throw new ApiError("This console is limited to HR administrators.", 403);
  }
  return {
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    sessionVersion: result.user.sessionVersion,
    csrfToken: result.csrfToken
  };
}

export async function loadBackendState(current: HrState, session: BackendSession): Promise<{ state: HrState; updatedAt?: string }> {
  const consoleState = await loadBackendConsoleState();
  if (consoleState?.data) return { state: { ...current, ...consoleState.data }, updatedAt: consoleState.updatedAt };

  const [employees, departments, leaves, payroll] = await Promise.all([
    apiList<BackendEmployee>("/employees"),
    apiList<BackendDepartment>("/departments"),
    apiList<BackendLeave>("/leave/requests"),
    apiList<BackendPayroll>("/payroll")
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

export async function loadBackendConsoleState() {
  return apiRequest<BackendConsoleState | null>("/console-state");
}

export async function saveBackendState(state: HrState, session: BackendSession) {
  return apiRequest<BackendConsoleState>("/console-state", {
    method: "PUT",
    csrfToken: session.csrfToken,
    body: JSON.stringify({ data: state, updatedAt: session.stateUpdatedAt })
  });
}

export function loadBackupStatus(session: BackendSession) {
  return apiRequest<BackendBackupStatus>("/console-state/backups/status");
}

export function createBackendBackup(session: BackendSession) {
  return apiRequest<{ id: string; kind: string; createdAt: string }>("/console-state/backups", {
    method: "POST",
    csrfToken: session.csrfToken
  });
}

export function rollbackLatestBackendBackup(session: BackendSession) {
  return apiRequest<BackendConsoleState>("/console-state/backups/rollback-latest", {
    method: "POST",
    csrfToken: session.csrfToken
  });
}

export async function generateBackendPayroll(session: BackendSession, year: number, month: number) {
  return apiRequest<BackendPayroll[]>("/payroll/generate", {
    method: "POST",
    csrfToken: session.csrfToken,
    body: JSON.stringify({ year, month })
  });
}

export async function logoutBackend(session: BackendSession) {
  return apiRequest<{ loggedOut: boolean }>("/auth/logout", {
    method: "POST",
    csrfToken: session.csrfToken
  });
}

async function apiList<T>(path: string) {
  const records: T[] = [];
  for (let page = 1; page <= 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const envelope = await apiRequestEnvelope<T[]>(`${path}${separator}page=${page}&limit=100`);
    const pageRecords = envelope.data ?? [];
    records.push(...pageRecords);
    const meta = envelope.meta as { totalPages?: number } | undefined;
    if (meta?.totalPages !== undefined ? page >= meta.totalPages : pageRecords.length < 100) return records;
  }
  throw new ApiError("The data set is too large to load safely.", 422);
}

async function apiRequest<T>(path: string, init: RequestInit & { csrfToken?: string } = {}): Promise<T> {
  const envelope = await apiRequestEnvelope<T>(path, init);
  return envelope.data as T;
}

async function apiRequestEnvelope<T>(path: string, init: RequestInit & { csrfToken?: string } = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set("Content-Type", "application/json");
  if (init.csrfToken) headers.set("X-CSRF-Token", init.csrfToken);

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: "same-origin" });
  let payload: Partial<ApiEnvelope<T>> | undefined;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok || payload?.success === false) {
    throw new ApiError(payload?.message || `API request failed (${response.status})`, response.status);
  }

  if (payload && "data" in payload) return payload as ApiEnvelope<T>;
  return { success: true, data: payload as T };
}

function isHrConsoleRole(role: unknown): role is string {
  return role === "SUPER_ADMIN" || role === "HR_ADMIN";
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
    loanDeduction: 0,
    loanDeductions: [],
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
