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
export const backendSessionKey = "medtech-hr-erp-backend-session-v2";
export const authorizationExpiredEvent = "medtech-hr-authorization-expired";

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
  displayName: string;
  csrfToken: string;
  roles: string[];
  permissions: string[];
  departmentScopeIds: string[];
  sessionId: string;
  authProvider: string;
  authorizationVersion: number;
  employeeId?: string | null;
};

type BackendSessionResponse = {
  csrfToken: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
    permissions: string[];
    departmentScopeIds: string[];
    sessionId: string;
    authProvider: string;
    authorizationVersion: number;
    employeeId?: string | null;
  };
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
  salary?: string | number;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  department?: BackendDepartment | null;
  position?: { title: string; code: string } | null;
  manager?: Pick<BackendEmployee, "employeeCode" | "firstName" | "lastName"> | null;
  profile?: Record<string, unknown> | null;
  bankAccount?: Record<string, unknown> | null;
  benefits?: Record<string, unknown> | null;
  credentials?: Array<Record<string, unknown>>;
  education?: Array<Record<string, unknown>>;
  salaryRecords?: Array<Record<string, unknown>>;
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
  lineItems?: Array<Record<string, unknown>>;
  employee?: BackendEmployee;
};


export function loadBackendSession(): BackendSession | null {
  try {
    const raw = sessionStorage.getItem(backendSessionKey) || localStorage.getItem(backendSessionKey);
    localStorage.removeItem(backendSessionKey);
    const session = raw ? JSON.parse(raw) as Partial<BackendSession> : null;
    return session?.id && session?.csrfToken && session.email && session.sessionId && typeof session.authProvider === "string"
      && Number.isInteger(session.authorizationVersion) && Array.isArray(session.roles)
      && Array.isArray(session.permissions) && Array.isArray(session.departmentScopeIds)
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

export function startMicrosoftStepUp() {
  window.location.assign(`${apiBaseUrl}/auth/microsoft/step-up`);
}

function backendSession(result: BackendSessionResponse): BackendSession {
  return {
    id: result.user.id,
    email: result.user.email,
    displayName: result.user.displayName,
    roles: result.user.roles,
    permissions: result.user.permissions,
    departmentScopeIds: result.user.departmentScopeIds,
    sessionId: result.user.sessionId,
    authProvider: result.user.authProvider,
    authorizationVersion: result.user.authorizationVersion,
    employeeId: result.user.employeeId,
    csrfToken: result.csrfToken
  };
}

export function hasPermission(session: BackendSession, permission: string) {
  return session.permissions.includes(permission);
}

export function hasActiveSuperAdminRole(session: Pick<BackendSession, "roles">) {
  return session.roles.includes("SUPER_ADMIN");
}

export function hasActiveSystemAdministratorRole(session: Pick<BackendSession, "roles">) {
  return session.roles.includes("SUPER_ADMIN") || session.roles.includes("ADMIN");
}

export function hasAnyPermission(session: BackendSession, ...permissions: string[]) {
  return permissions.some(permission => hasPermission(session, permission));
}

export function hasAllPermissions(session: BackendSession, ...permissions: string[]) {
  return permissions.every(permission => hasPermission(session, permission));
}

export async function loadBackendState(current: HrState, session: BackendSession): Promise<{ state: HrState; updatedAt?: string }> {
  const listWhen = <T>(allowed: boolean, path: string) => allowed ? apiList<T>(path) : Promise.resolve([] as T[]);
  const getWhen = <T>(allowed: boolean, path: string) => allowed ? apiRequest<T>(path) : Promise.resolve(null as T);
  const broadEmployeeRead = hasAnyPermission(session, "employee.team.read", "employee.management.read", "employee.hr.read", "employee.read_all");
  const employeesRequest = broadEmployeeRead
    ? apiList<BackendEmployee>("/employees")
    : hasPermission(session, "employee.self.read")
      ? apiRequest<BackendEmployee>("/employees/me").then(employee => employee ? [employee] : [])
      : Promise.resolve([] as BackendEmployee[]);
  const [employees, departments, leaveTypes, attendance, leaves, payroll, trips, expenses, loans, jobs, candidates, eos, documents, settings] = await Promise.all([
    employeesRequest,
    listWhen<BackendDepartment>(hasPermission(session, "department.read"), "/departments"),
    listWhen<Record<string, unknown>>(hasAnyPermission(session, "leave.self.read", "leave.configure"), "/leave/types"),
    listWhen<Record<string, unknown>>(hasAnyPermission(session, "attendance.self.read", "attendance.team.read", "attendance.management.read", "attendance.hr.read", "attendance.read_all"), "/attendance"),
    Promise.resolve([] as BackendLeave[]),
    Promise.resolve([] as Array<BackendPayroll & { lineItems?: Array<Record<string, unknown>> }>),
    listWhen<Record<string, unknown>>(hasAnyPermission(session, "trip.self.read", "trip.team.read", "trip.management.read", "trip.hr.read", "trip.read_all"), "/business-trips"),
    listWhen<Record<string, unknown>>(hasAnyPermission(session, "expense.self.read", "expense.team.read", "expense.management.read", "expense.hr.read", "expense.read_all"), "/expenses"),
    listWhen<Record<string, unknown>>(hasAnyPermission(session, "loan.self.read", "loan.hr.read", "loan.audit.read", "loan.read_all"), "/loans"),
    listWhen<Record<string, unknown>>(hasPermission(session, "recruitment.read"), "/recruitment/jobs"),
    listWhen<Record<string, unknown>>(hasPermission(session, "recruitment.read"), "/recruitment/candidates"),
    listWhen<Record<string, unknown>>(hasPermission(session, "eos.read"), "/eos"),
    listWhen<Record<string, unknown>>(hasAnyPermission(session, "document.self.read", "document.hr.read"), "/documents"),
    getWhen<Record<string, unknown> | null>(hasPermission(session, "organization.read"), "/organization-settings")
  ]);

  const departmentNames = departments.map(item => item.name).filter(Boolean);
  const attendanceState: HrState["attendance"] = {};
  const attendanceApprovals: HrState["attendanceApprovals"] = {};
  for (const item of attendance) {
    const day = dateOnly(String(item.attendanceDate || ""));
    const employeeId = String(item.employeeId || "");
    if (!day || !employeeId) continue;
    attendanceState[day] ??= {};
    attendanceApprovals[day] ??= {};
    attendanceState[day][employeeId] = ({ PRESENT: "P", LATE: "P", HALF_DAY: "H", ON_LEAVE: "L", ABSENT: "A" } as const)[String(item.status)] ?? "A";
    attendanceApprovals[day][employeeId] = item.approvalStatus === "APPROVED" ? "Approved" : "Not approved";
  }
  const company = settings ? {
    name: String(settings.name || current.settings.company.name),
    legalName: String(settings.legalName || current.settings.company.legalName),
    tagline: String(settings.tagline || ""), address: String(settings.address || ""), phone: String(settings.phone || ""),
    email: String(settings.email || ""), website: String(settings.website || ""), currency: String(settings.currency || "QAR"),
    wpsEmployerEid: String(settings.wpsEmployerEid || ""), wpsPayerEid: String(settings.wpsPayerEid || ""),
    wpsPayerQid: String(settings.wpsPayerQid || ""), wpsPayerBank: String(settings.wpsPayerBank || ""), wpsPayerIban: String(settings.wpsPayerIban || ""),
    accountPhoto: String(settings.accountPhoto || "")
  } : current.settings.company;
  const employeeMap = new Map(employees.map(employee => [employee.id, employee]));
  for (const payrollRecord of payroll) {
    if (!payrollRecord.employee || employeeMap.has(payrollRecord.employee.id)) continue;
    employeeMap.set(payrollRecord.employee.id, {
      ...payrollRecord.employee,
      salary: payrollRecord.baseSalary,
      salaryRecords: [{ baseSalary: payrollRecord.baseSalary, allowances: payrollRecord.allowances, bonuses: payrollRecord.bonuses }]
    });
  }
  return {
    state: {
      ...current,
      employees: [...employeeMap.values()].map(mapEmployee),
      attendance: attendanceState,
      attendanceApprovals,
      leaves: leaves.map(mapLeave),
      payroll: payroll.map(mapPayroll),
      businessTrips: trips.map(item => ({
        id: String(item.id), employeeId: String(item.employeeId), destination: String(item.destination || ""), purpose: String(item.purpose || ""),
        from: dateOnly(String(item.startDate || "")), to: dateOnly(String(item.endDate || "")), days: Number(item.days || 0),
        perDiem: Number(item.perDiem || 0), travelCost: Number(item.travelCost || 0), advanceAmount: Number(item.advanceAmount || 0),
        status: titleCase(String(item.status)) as HrState["businessTrips"][number]["status"], createdOn: dateOnly(String(item.createdAt || ""))
      })),
      expenses: expenses.map(item => ({
        id: String(item.id), employeeId: String(item.employeeId), tripId: item.tripId ? String(item.tripId) : undefined,
        category: String(item.category || ""), date: dateOnly(String(item.expenseDate || "")), amount: Number(item.amount || 0),
        description: String(item.description || ""), status: titleCase(String(item.status)) as HrState["expenses"][number]["status"], createdOn: dateOnly(String(item.createdAt || ""))
      })),
      loans: loans.map(mapLoan),
      loanRepayments: loans.flatMap(item => Array.isArray(item.repayments) ? item.repayments.map(repayment => mapRepayment(repayment as Record<string, unknown>)) : []),
      jobs: jobs.map(item => ({
        id: String(item.id), title: String(item.title || ""), dept: String((item.department as Record<string, unknown> | undefined)?.name || ""),
        openings: Number(item.openings || 1), status: titleCase(String(item.status)) as HrState["jobs"][number]["status"],
        postedOn: dateOnly(String(item.postedOn || "")), description: String(item.description || "")
      })),
      candidates: candidates.map(item => ({
        id: String(item.id), jobId: String(item.jobId), name: String(item.name || ""), email: String(item.email || ""), phone: String(item.phone || ""),
        stage: titleCase(String(item.stage)) as HrState["candidates"][number]["stage"], rating: Number(item.rating || 0), notes: String(item.notes || ""),
        appliedOn: dateOnly(String(item.appliedOn || "")), employeeId: item.employeeId ? String(item.employeeId) : undefined
      })),
      eosRecords: eos.map(item => ({
        id: String(item.id), employeeId: String(item.employeeId), asOf: dateOnly(String(item.asOf || "")), reason: String(item.reason || ""),
        serviceYears: Number(item.serviceYears || 0), gratuity: Number(item.gratuity || 0), leaveEncashment: Number(item.leaveEncashment || 0),
        lopDeduction: Number(item.lopDeduction || 0), expenseReimbursement: Number(item.expenseReimbursement || 0), tripAdvanceDeduction: Number(item.tripAdvanceDeduction || 0),
        netSettlement: Number(item.netSettlement || 0), status: titleCase(String(item.status)) as HrState["eosRecords"][number]["status"], createdOn: dateOnly(String(item.createdAt || ""))
      })),
      documents: documents.map(item => ({
        id: String(item.id), employeeId: String(item.employeeId), template: String(item.documentType) as HrState["documents"][number]["template"],
        documentNumber: String(item.documentNumber || item.id), generatedOn: dateOnly(String(item.createdAt || "")), status: "Generated" as const,
        filename: String(item.fileName || "document"), sizeBytes: item.sizeBytes == null ? undefined : Number(item.sizeBytes), downloadUrl: String(item.fileUrl || "")
      })),
      settings: {
        ...current.settings,
        company,
        departments: departmentNames.length ? departmentNames : current.settings.departments,
        leaveTypes: leaveTypes.map(item => ({ id: String(item.id), name: String(item.name), days: Number(item.annualAllowanceDays || 0) })),
        workdayHours: Number(settings?.workdayHours || current.settings.workdayHours),
        halfDayHours: Number(settings?.halfDayHours || current.settings.halfDayHours),
        loanDeductionCap: { type: settings?.loanCapType === "PERCENT" ? "Percent" : "Amount", value: Number(settings?.loanCapValue || 0) }
      }
    }
  };
}

export async function generateBackendPayroll(session: BackendSession, year: number, month: number) {
  return apiRequest<{ id: string; payrolls: BackendPayroll[] }>("/payroll/generate", {
    method: "POST",
    csrfToken: session.csrfToken,
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({ year, month })
  });
}

export async function logoutBackend(session: BackendSession) {
  return apiRequest<{ loggedOut: boolean }>("/auth/logout", {
    method: "POST",
    csrfToken: session.csrfToken
  });
}

export async function apiList<T>(path: string) {
  const records: T[] = [];
  const [pathname, query = ""] = path.split("?", 2);
  const params = new URLSearchParams(query);
  params.set("limit", "100");
  for (let page = 1; page <= 100; page += 1) {
    params.set("page", String(page));
    const envelope = await apiRequestEnvelope<T[]>(`${pathname}?${params}`);
    const pageRecords = envelope.data ?? [];
    records.push(...pageRecords);
    const meta = envelope.meta as { totalPages?: number } | undefined;
    if (meta?.totalPages !== undefined ? page >= meta.totalPages : pageRecords.length < 100) return records;
  }
  throw new ApiError("The data set is too large to load safely.", 422);
}

export async function apiPage<T, M = unknown>(path: string, init: RequestInit & { csrfToken?: string } = {}) {
  const envelope = await apiRequestEnvelope<T[]>(path, init);
  return { data: envelope.data ?? [], meta: envelope.meta as M | undefined };
}

export async function apiRequest<T>(path: string, init: RequestInit & { csrfToken?: string } = {}): Promise<T> {
  const envelope = await apiRequestEnvelope<T>(path, init);
  return envelope.data as T;
}

export async function apiDownload(path: string, init: RequestInit & { csrfToken?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.csrfToken) headers.set("X-CSRF-Token", init.csrfToken);
  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event(authorizationExpiredEvent));
    let message = `Download failed (${response.status})`;
    try { message = (await response.json() as { message?: string }).message || message; } catch { /* empty */ }
    throw new ApiError(message, response.status);
  }
  const disposition = response.headers.get("content-disposition") || "";
  const fileName = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "download";
  return { blob: await response.blob(), fileName };
}

async function apiRequestEnvelope<T>(path: string, init: RequestInit & { csrfToken?: string } = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (init.csrfToken) headers.set("X-CSRF-Token", init.csrfToken);

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers, credentials: "same-origin" });
  let payload: Partial<ApiEnvelope<T>> | undefined;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }

  if (!response.ok || payload?.success === false) {
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new Event(authorizationExpiredEvent));
    throw new ApiError(payload?.message || `API request failed (${response.status})`, response.status);
  }

  if (payload && "data" in payload) return payload as ApiEnvelope<T>;
  return { success: true, data: payload as T };
}

function mapEmployee(employee: BackendEmployee): EmployeeRecord {
  const fields = Object.fromEntries(employeeImportColumns.map(column => [column, ""]));
  const salaryRecord = employee.salaryRecords?.[0];
  const salary = String(Number(salaryRecord?.baseSalary ?? employee.salary ?? 0));
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
      ...mapEmployeeDetails(employee),
      Basic: salary,
      HRA: String(Number(salaryRecord?.allowances || 0)),
      "Overtime Amount": String(Number(salaryRecord?.bonuses || 0)),
      Total: String(Number(salary) + Number(salaryRecord?.allowances || 0) + Number(salaryRecord?.bonuses || 0))
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
    reviewStage: leave.status === "PENDING_LINE_MANAGER" ? "Manager" : leave.status === "PENDING_MANAGER" ? "Manager" : leave.status === "PENDING_HR" ? "HR" : undefined,
    appliedOn: dateOnly(leave.createdAt),
    decidedOn: dateOnly(leave.approvedAt)
  };
}

function mapPayroll(item: BackendPayroll): PayrollSlip {
  const base = Number(item.baseSalary || 0);
  const allowances = Number(item.allowances || 0);
  const deductions = Number(item.deductions || 0);
  const bonus = Number(item.bonuses || 0);
  const lines = item.lineItems ?? [];
  const lineAmount = (kind: string) => lines.filter(line => line.kind === kind).reduce((sum, line) => sum + Number(line.amount || 0), 0);
  const loanDeductions = lines.filter(line => line.kind === "LOAN_REPAYMENT").map(line => ({ loanId: String(line.loanId || ""), amount: Number(line.amount || 0) }));
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
    loanDeduction: loanDeductions.reduce((sum, line) => sum + line.amount, 0),
    loanDeductions,
    lopDays: Number(String(lines.find(line => line.kind === "LOSS_OF_PAY")?.description || "").match(/[\d.]+/)?.[0] || 0),
    lopAmount: lineAmount("LOSS_OF_PAY"),
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

function mapEmployeeDetails(employee: BackendEmployee): Record<string, string> {
  const profile = employee.profile ?? {};
  const bank = employee.bankAccount ?? {};
  const benefits = employee.benefits ?? {};
  const credentials = employee.credentials ?? [];
  const education = employee.education?.[0] ?? {};
  const credential = (type: string) => credentials.find(item => item.type === type) ?? {};
  const qid = credential("QID");
  const permit = credential("WORK_PERMIT");
  const passport = credential("PASSPORT");
  const license = credential("DRIVING_LICENSE");
  const insurance = credential("INSURANCE");
  const value = (record: Record<string, unknown>, key: string) => record[key] == null ? "" : String(record[key]);
  const yesNo = (record: Record<string, unknown>, key: string) => record[key] ? "Yes" : "No";
  return {
    "Employee Category": value(profile, "employeeCategory"), "Work Shift": value(profile, "workShift"), Company: value(profile, "company"),
    "Sponsor Name": value(profile, "sponsorName"), "WPS Sponsor": value(profile, "wpsSponsor"), "Grade/Band": value(profile, "gradeBand"),
    "Family Status (Yes/No)": value(profile, "familyStatus"), "Leave Policy": value(profile, "leavePolicy"), "Last Rejoin Date": dateOnly(value(profile, "lastRejoinDate")),
    "Business Unit": value(profile, "businessUnit"), "Working Company Name": value(profile, "workingCompanyName"), "Cost Centre": value(profile, "costCentre"),
    Nationality: value(profile, "nationality"), "RP/ID Number": value(qid, "number"), "RP/ID Profession": value(profile, "residenceProfession"),
    "QID Expiry Date": dateOnly(value(qid, "expiryDate")), "Visa Type": value(profile, "visaType"), "Hire Type": value(profile, "hireType"),
    "Confirmation Date": dateOnly(value(profile, "confirmationDate")), "ESB Date": dateOnly(value(profile, "esbDate")), "Marital Status": value(profile, "maritalStatus"),
    "Office Mobile No.": value(profile, "officeMobile"), "Personal Mobile No.": value(profile, "personalMobile"), "No. of Dependents": value(profile, "dependents"),
    "Blood Group": value(profile, "bloodGroup"), "Local Building/Villa #": value(profile, "localBuilding"), "Local Street #": value(profile, "localStreet"),
    "Local Zone #": value(profile, "localZone"), "International Apartment": value(profile, "internationalApartment"), "International Building": value(profile, "internationalBuilding"),
    "International Floor": value(profile, "internationalFloor"), "International Street": value(profile, "internationalStreet"), "International State": value(profile, "internationalState"),
    "International Country": value(profile, "internationalCountry"), "International Zip Code": value(profile, "internationalZipCode"),
    "Emergency Contact Relationship": value(profile, "emergencyRelationship"), "Salary Pay Type": value(profile, "salaryPayType"), "Office File No.": value(profile, "officeFileNumber"),
    "Access Card No.": value(profile, "accessCardNumber"), "Bank Code": value(bank, "bankCode"), "IBAN No.": value(bank, "iban"), "Account No.": value(bank, "accountNumber"),
    "Travel Sector": value(benefits, "travelSector"), "Travel Cost": value(benefits, "travelCost"), "No. of Tickets - Employee (Year)": value(benefits, "employeeTicketsPerYear"),
    "Ticket Balance (%)": value(benefits, "ticketBalancePercent"), "No. of Tickets - Family": value(benefits, "familyTickets"),
    "Company Accommodation": yesNo(benefits, "companyAccommodation"), "Company Transportation": yesNo(benefits, "companyTransportation"),
    "Overtime Eligible": yesNo(benefits, "overtimeEligible"), "Company Food": yesNo(benefits, "companyFood"), "Company Fuel Card": yesNo(benefits, "companyFuelCard"),
    "Highest Education Qualification": value(education, "qualification"), "Year of Passing": value(education, "yearOfPassing"),
    "Work Permit No.": value(permit, "number"), "Work Permit Issue Date": dateOnly(value(permit, "issueDate")), "Work Permit Expiry Date": dateOnly(value(permit, "expiryDate")),
    "Passport No.": value(passport, "number"), "Passport Place of Issue": value(passport, "placeOfIssue"), "Passport Issue Date": dateOnly(value(passport, "issueDate")), "Passport Expiry Date": dateOnly(value(passport, "expiryDate")),
    "License Type": value(license, "profession"), "Driving License No.": value(license, "number"), "Driving License Expiry Date": dateOnly(value(license, "expiryDate")),
    "Insurance Card No.": value(insurance, "number"), "Insurance Issue Date": dateOnly(value(insurance, "issueDate")), "Insurance Expiry Date": dateOnly(value(insurance, "expiryDate"))
  };
}

function mapLoan(item: Record<string, unknown>): HrState["loans"][number] {
  const overrides = Array.isArray(item.overrides) ? item.overrides : [];
  return {
    id: String(item.id), employeeId: String(item.employeeId), type: String(item.type || "Loan"), principal: Number(item.principal || 0),
    disbursementDate: dateOnly(String(item.disbursementDate || "")), startPeriod: `${item.startYear}-${String(item.startMonth).padStart(2, "0")}`,
    repaymentMode: ({ DURATION: "Duration", MONTHLY_LIMIT: "Monthly limit", MANUAL: "Manual" } as const)[String(item.repaymentMode)] ?? "Manual",
    termMonths: Number(item.termMonths || 1), monthlyLimit: Number(item.monthlyLimit || 0),
    status: titleCase(String(item.status)) as HrState["loans"][number]["status"], reference: String(item.reference || ""), notes: String(item.notes || ""),
    createdOn: dateOnly(String(item.createdAt || "")),
    deductionOverrides: Object.fromEntries(overrides.map(raw => {
      const row = raw as Record<string, unknown>;
      return [`${row.year}-${String(row.month).padStart(2, "0")}`, { amount: Number(row.amount || 0), reason: String(row.reason || ""), approvedAboveLimit: Boolean(row.approvedAboveLimit), updatedOn: dateOnly(String(row.updatedAt || "")) }];
    }))
  };
}

function mapRepayment(item: Record<string, unknown>): HrState["loanRepayments"][number] {
  return {
    id: String(item.id), loanId: String(item.loanId), payrollId: item.payrollId ? String(item.payrollId) : undefined,
    year: Number(item.year), month: Number(item.month), amount: Number(item.amount || 0),
    source: item.source === "PAYROLL" ? "Payroll" : "Manual", status: item.status === "REVERSED" ? "Reversed" : "Posted",
    note: String(item.note || ""), postedOn: dateOnly(String(item.postedAt || ""))
  };
}
