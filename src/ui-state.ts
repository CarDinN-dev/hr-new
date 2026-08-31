import type { HrState, NavItem } from "./data";

export const operationalPageSize = 20;

type SearchInput = Record<string, unknown>;

function optionalString(value: unknown, maxLength: number) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().slice(0, maxLength);
  return normalized || undefined;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export type CommonSearch = { q?: string };
export type TeamSearch = { page?: number };
export type AttendanceSearch = { date?: string; department?: string; status?: string; page?: number; month?: number; year?: number; summaryPage?: number };

export function commonSearch(search: SearchInput): CommonSearch {
  const q = optionalString(search.q, 100);
  return { q: q && q.length >= 2 ? q : undefined };
}

export function teamSearch(search: SearchInput): TeamSearch {
  return { page: positiveInteger(search.page) };
}

export function attendanceSearch(search: SearchInput): AttendanceSearch {
  const date = optionalString(search.date, 10);
  const department = optionalString(search.department, 150);
  const status = optionalString(search.status, 20);
  const month = Number(search.month);
  const year = Number(search.year);
  return {
    date: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
    department,
    status: status && ["Present", "Half-day", "Leave", "Absent", "Unmarked"].includes(status) ? status : undefined,
    page: positiveInteger(search.page),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : undefined,
    year: Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : undefined,
    summaryPage: positiveInteger(search.summaryPage),
  };
}

export function shellSearch(search: SearchInput): CommonSearch & AttendanceSearch {
  return { ...commonSearch(search), ...attendanceSearch(search) };
}

export function paginate<T>(items: readonly T[], requestedPage: number, limit = operationalPageSize) {
  const totalPages = Math.max(1, Math.ceil(items.length / limit));
  const page = Math.min(Math.max(requestedPage, 1), totalPages);
  return { page, totalPages, items: items.slice((page - 1) * limit, page * limit) };
}

export type DepartmentDraft = { key: string; name: string };
export type LeaveTypeDraft = HrState["settings"]["leaveTypes"][number];

export function settingsEditorErrors(departments: readonly DepartmentDraft[], leaveTypes: readonly LeaveTypeDraft[]) {
  const departmentErrors: Record<string, string> = {};
  const leaveTypeErrors: Record<string, { name?: string; days?: string }> = {};
  const departmentNames = departments.map(item => item.name.trim().toLocaleLowerCase());
  const leaveTypeNames = leaveTypes.map(item => item.name.trim().toLocaleLowerCase());

  departments.forEach((department, index) => {
    const name = department.name.trim();
    if (!name) departmentErrors[department.key] = "Enter a department name.";
    else if (name.length > 150) departmentErrors[department.key] = "Use 150 characters or fewer.";
    else if (departmentNames.indexOf(name.toLocaleLowerCase()) !== index) departmentErrors[department.key] = "Department names must be unique.";
  });

  leaveTypes.forEach((leaveType, index) => {
    const errors: { name?: string; days?: string } = {};
    const name = leaveType.name.trim();
    if (!name) errors.name = "Enter a leave type name.";
    else if (name.length > 150) errors.name = "Use 150 characters or fewer.";
    else if (leaveTypeNames.indexOf(name.toLocaleLowerCase()) !== index) errors.name = "Leave type names must be unique.";
    if (!Number.isFinite(leaveType.days) || leaveType.days < 0 || leaveType.days > 366 || Math.abs(leaveType.days * 100 - Math.round(leaveType.days * 100)) > 1e-8) {
      errors.days = "Enter 0–366 days with no more than two decimal places.";
    }
    if (errors.name || errors.days) leaveTypeErrors[leaveType.id] = errors;
  });

  return {
    departments: departmentErrors,
    leaveTypes: leaveTypeErrors,
    valid: !Object.keys(departmentErrors).length && !Object.keys(leaveTypeErrors).length,
  };
}

export function statusActionLabel(status: string, previousStatus?: string) {
  if (status === "Active") return previousStatus === "Paused" ? "Resume" : "Activate";
  return ({ Approved: "Approve", Rejected: "Reject", Closed: "Close", Paid: "Mark paid", Paused: "Pause", Cancelled: "Cancel", Settled: "Settle" } as Record<string, string>)[status] ?? status;
}

export type NotificationDestination = { nav: Extract<NavItem, "Leave" | "Certificates" | "Payroll">; hashPrefix: "leave" | "service-request" | "payroll" };

export function notificationDestination(resourceType?: string | null): NotificationDestination | null {
  if (resourceType === "LeaveRequest") return { nav: "Leave", hashPrefix: "leave" };
  if (resourceType === "ServiceRequest") return { nav: "Certificates", hashPrefix: "service-request" };
  if (resourceType === "Payroll") return { nav: "Payroll", hashPrefix: "payroll" };
  return null;
}
