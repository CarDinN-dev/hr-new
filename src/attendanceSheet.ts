import type { AttendanceCode, HrState } from "./data";
import { parseEmployeeSheet } from "./employeeSheet";

const statusCodes: Record<string, AttendanceCode> = {
  p: "P",
  present: "P",
  h: "H",
  halfday: "H",
  l: "L",
  leave: "L",
  a: "A",
  absent: "A"
};

export function attendanceTemplateHtml() {
  return "<!doctype html><html><head><meta charset=\"utf-8\"></head><body><table><thead><tr><th>Date</th><th>Employee Code</th><th>Status</th></tr></thead><tbody><tr><td></td><td></td><td></td></tr></tbody></table></body></html>";
}

export function parseAttendanceSheet(text: string) {
  return parseEmployeeSheet(text);
}

export function applyAttendanceRows(state: HrState, rows: Array<Record<string, string>>) {
  const employees = new Map(state.employees.map(employee => [employee.fields["Employee Code"].trim().toLowerCase(), employee]));
  const attendance = { ...state.attendance };
  const attendanceApprovals = { ...state.attendanceApprovals };
  const clonedDates = new Set<string>();
  let imported = 0;
  let skipped = 0;

  for (const row of rows) {
    const date = normalizeDate(row.Date || row["Attendance Date"]);
    const employee = employees.get((row["Employee Code"] || "").trim().toLowerCase());
    const code = normalizeStatus(row.Status || row["Attendance Status"]);
    if (!date || !employee || !code) {
      skipped += 1;
      continue;
    }

    if (!clonedDates.has(date)) {
      attendance[date] = { ...(attendance[date] || {}) };
      attendanceApprovals[date] = { ...(attendanceApprovals[date] || {}) };
      clonedDates.add(date);
    }
    attendance[date][employee.id] = code;
    delete attendanceApprovals[date][employee.id];
    imported += 1;
  }

  const dates = [...clonedDates].sort();
  return {
    state: imported ? { ...state, attendance, attendanceApprovals } : state,
    imported,
    skipped,
    dates: dates.length,
    latestDate: dates.at(-1)
  };
}

export function buildAttendanceImportRows(state: HrState, rows: Array<Record<string, string>>) {
  const employees = new Map(state.employees.map(employee => [employee.fields["Employee Code"].trim().toLowerCase(), employee]));
  return rows.map((row, index) => {
    const attendanceDate = normalizeDate(row.Date || row["Attendance Date"]);
    const employee = employees.get((row["Employee Code"] || "").trim().toLowerCase());
    const code = normalizeStatus(row.Status || row["Attendance Status"]);
    if (!attendanceDate || !employee || !code) throw new Error(`Attendance row ${index + 2} has an invalid date, employee code, or status.`);
    return {
      employeeId: employee.id,
      attendanceDate,
      status: ({ P: "PRESENT", H: "HALF_DAY", L: "ON_LEAVE", A: "ABSENT" } as const)[code],
      notes: (row.Notes || row.Note || "").trim() || undefined
    };
  });
}

function normalizeStatus(value?: string) {
  return statusCodes[(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "")];
}

function normalizeDate(value?: string) {
  const text = (value || "").trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(text);
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : undefined;
  if (!parts) return undefined;
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
