import type { AttendanceCode, HrState } from "./data";
import { parseEmployeeSheet } from "./employeeSheet";
import * as CFB from "cfb";

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

export async function parseAttendanceWorkbook(file: File) {
  const data = new Uint8Array(await file.arrayBuffer());
  if (!isLegacyWorkbook(data)) return parseAttendanceSheet(new TextDecoder().decode(data));
  const workbook = CFB.find(CFB.read(data, { type: "array" }), "Workbook")?.content;
  if (!workbook) throw new Error("This .xls file does not contain an Excel workbook.");
  return parseBiff8AttendanceRows(new Uint8Array(workbook as unknown as Uint8Array));
}

export function parseAttendanceWorkbookRows(sourceRows: ReadonlyArray<ReadonlyArray<unknown>>) {
  const rows = sourceRows.map(row => row.map(cellText));
  const simpleRows = parseSimpleAttendanceRows(rows);
  return simpleRows.length ? simpleRows : parseLogsAttendanceRows(rows);
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

function parseSimpleAttendanceRows(rows: string[][]) {
  const [headers = [], ...body] = rows;
  const columns = headers.map(normalizedHeader);
  const dateColumn = columns.findIndex(header => header === "date" || header === "attendancedate");
  const employeeColumn = columns.findIndex(header => header === "employeecode");
  const statusColumn = columns.findIndex(header => header === "status" || header === "attendancestatus");
  if (dateColumn < 0 || employeeColumn < 0 || statusColumn < 0) return [];
  return body.map(row => ({ Date: row[dateColumn] ?? "", "Employee Code": row[employeeColumn] ?? "", Status: row[statusColumn] ?? "" }));
}

function parseLogsAttendanceRows(rows: string[][]) {
  const dates = reportDates(rows);
  if (!dates.length) return [];
  const dateHeaderIndex = rows.findIndex(row => row.filter(value => dates.some(date => dayOfMonth(date) === dayOfMonth(value))).length >= 2);
  if (dateHeaderIndex < 0) return [];

  const dateColumns = rows[dateHeaderIndex].flatMap((value, index) => {
    const date = dates.find(item => dayOfMonth(item) === dayOfMonth(value));
    return date ? [[index, date] as const] : [];
  });
  const employeeColumn = Math.max(0, rows[dateHeaderIndex].findIndex(value => /^(no|cardno|employeecode)$/i.test(normalizedHeader(value))));
  const imported: Array<Record<string, string>> = [];

  for (const row of rows.slice(dateHeaderIndex + 1)) {
    const employeeCode = row[employeeColumn]?.trim();
    if (!employeeCode || !isEmployeeCode(employeeCode)) continue;
    for (const [column, date] of dateColumns) {
      const status = statusFromLog(row[column]);
      if (status) imported.push({ Date: date, "Employee Code": employeeCode, Status: status });
    }
  }
  return imported;
}

function reportDates(rows: string[][]) {
  const duration = rows.flat().find(value => /\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}\s*(?:~|-|to)\s*\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}/i.test(value));
  if (!duration) return [];
  const values = duration.match(/\d{1,2}[/.\-]\d{1,2}[/.\-]\d{4}/g) ?? [];
  const [start, end] = values.map(normalizeDate);
  if (!start || !end || start > end) return [];
  const dates: string[] = [];
  for (let day = new Date(`${start}T00:00:00Z`); day <= new Date(`${end}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

function statusFromLog(value?: string) {
  const text = (value ?? "").trim();
  if (!text) return undefined;
  const status = normalizeStatus(text);
  if (status) return status;
  if (/\bon\s*leave\b/i.test(text)) return "L";
  if (/\babsent\b|^x$/i.test(text)) return "A";
  return /\b\d{1,2}:\d{2}\b/.test(text) ? "P" : undefined;
}

function dayOfMonth(value: string) {
  const date = normalizeDate(value);
  if (date) return Number(date.slice(-2));
  return /^\d{1,2}$/.test(value.trim()) ? Number(value) : undefined;
}

function isEmployeeCode(value: string) {
  return !/^(name|note|total|attendance\s+list)$/i.test(value) && /^[\p{L}\p{N}][\p{L}\p{N}_/-]*$/u.test(value);
}

function cellText(value: unknown) {
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return value == null ? "" : String(value).trim();
}

function normalizedHeader(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isLegacyWorkbook(data: Uint8Array) {
  return [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((value, index) => data[index] === value);
}

function parseBiff8AttendanceRows(data: Uint8Array) {
  // ponytail: device exports one BIFF8 Logs sheet; extend only if its report format changes.
  const sharedStrings = readSharedStrings(data);
  const sheet = biffRecords(data).find(record => record.type === 0x0085 && /logs/i.test(readSheetName(data, record)));
  if (!sheet) throw new Error("This .xls file does not contain a Logs attendance sheet.");
  const offset = view(data).getUint32(sheet.start + 4, true);
  return parseAttendanceWorkbookRows(readBiff8Rows(data, offset, sharedStrings));
}

function readSharedStrings(data: Uint8Array) {
  // ponytail: current device exports keep its string table in one record; add CONTINUE support if that changes.
  const record = biffRecords(data).find(item => item.type === 0x00fc);
  if (!record) return [];
  const source = data.subarray(record.start + 4, record.end);
  const input = view(source);
  const count = input.getUint32(4, true);
  let cursor = 8;
  const strings: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const parsed = readBiffString(input, cursor);
    strings.push(parsed.value);
    cursor = parsed.next;
  }
  return strings;
}

function readBiff8Rows(data: Uint8Array, offset: number, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const record of biffRecords(data, offset)) {
    if (record.type === 0x000a) break;
    const input = view(data.subarray(record.start + 4, record.end));
    if (record.type === 0x00fd) setBiffCell(rows, input.getUint16(0, true), input.getUint16(2, true), sharedStrings[input.getUint32(6, true)] ?? "");
    if (record.type === 0x0204) setBiffCell(rows, input.getUint16(0, true), input.getUint16(2, true), readBiffString(input, 6).value);
    if (record.type === 0x0203) setBiffCell(rows, input.getUint16(0, true), input.getUint16(2, true), numberText(input.getFloat64(6, true)));
    if (record.type === 0x027e) setBiffCell(rows, input.getUint16(0, true), input.getUint16(2, true), numberText(readRk(input.getUint32(6, true))));
    if (record.type === 0x00bd) {
      const row = input.getUint16(0, true);
      const firstColumn = input.getUint16(2, true);
      for (let cursor = 4, column = firstColumn; cursor < input.byteLength - 2; cursor += 6, column += 1) setBiffCell(rows, row, column, numberText(readRk(input.getUint32(cursor + 2, true))));
    }
  }
  return rows;
}

function biffRecords(data: Uint8Array, start = 0) {
  const records: Array<{ type: number; start: number; end: number }> = [];
  const input = view(data);
  for (let cursor = start; cursor + 4 <= data.byteLength;) {
    const size = input.getUint16(cursor + 2, true);
    const end = cursor + 4 + size;
    if (end > data.byteLength) throw new Error("This .xls file is incomplete or invalid.");
    records.push({ type: input.getUint16(cursor, true), start: cursor, end });
    cursor = end;
  }
  return records;
}

function readSheetName(data: Uint8Array, record: { start: number; end: number }) {
  const input = view(data.subarray(record.start + 4, record.end));
  const characters = input.getUint8(6);
  const unicode = input.getUint8(7) & 1;
  return readCharacters(input, 8, characters, unicode);
}

function readBiffString(input: DataView, start: number) {
  const characters = input.getUint16(start, true);
  const flags = input.getUint8(start + 2);
  const richRuns = flags & 8 ? input.getUint16(start + 3, true) : 0;
  const extensionSize = flags & 4 ? input.getUint32(start + 3 + (flags & 8 ? 2 : 0), true) : 0;
  const contentStart = start + 3 + (flags & 8 ? 2 : 0) + (flags & 4 ? 4 : 0);
  const characterSize = flags & 1 ? 2 : 1;
  return { value: readCharacters(input, contentStart, characters, characterSize === 2), next: contentStart + characters * characterSize + richRuns * 4 + extensionSize };
}

function readCharacters(input: DataView, start: number, length: number, unicode: boolean | number) {
  let value = "";
  for (let index = 0; index < length; index += 1) value += String.fromCharCode(unicode ? input.getUint16(start + index * 2, true) : input.getUint8(start + index));
  return value;
}

function setBiffCell(rows: string[][], row: number, column: number, value: string) {
  const target = rows[row] ??= [];
  target[column] = value;
}

function readRk(value: number) {
  const integer = value & 2;
  const scaled = value & 1;
  const number = integer ? value >> 2 : view(new Uint8Array([0, 0, 0, 0, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xfc])).getFloat64(0, false);
  return scaled ? number / 100 : number;
}

function numberText(value: number) {
  return String(value);
}

function view(data: Uint8Array) {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}
