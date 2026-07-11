import { createEmptyEmployee, employeeImportColumns, normalizeEmployee, statusOptions, type EmployeeRecord, type HrState } from "./data";
import { nextEmployeeCode } from "./domain";

export function employeeTemplateHtml() {
  const headers = ["Status", ...employeeImportColumns];
  return `<!doctype html><html><head><meta charset="utf-8"></head><body><table><thead><tr>${headers.map(cell).join("")}</tr></thead><tbody><tr>${headers.map(() => "<td></td>").join("")}</tr></tbody></table></body></html>`;
}

export function parseEmployeeSheet(text: string) {
  const rows = text.trimStart().startsWith("<") ? parseHtmlRows(text) : parseDelimitedRows(text);
  const [headers = [], ...body] = rows.map(row => row.map(value => value.trim()));
  return body
    .filter(row => row.some(Boolean))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

export function applyEmployeeRows(state: HrState, rows: Array<Record<string, string>>) {
  let employees = [...state.employees];
  let added = 0;
  let updated = 0;

  for (const row of rows) {
    const suppliedCode = row["Employee Code"]?.trim();
    const existing = suppliedCode ? employees.find(employee => employee.fields["Employee Code"] === suppliedCode) : undefined;
    const code = suppliedCode || nextEmployeeCode(employees);
    const base = existing ?? createEmptyEmployee(code);
    const fields = { ...base.fields };

    for (const column of employeeImportColumns) {
      if (row[column] != null) fields[column] = row[column].trim();
    }
    fields["Employee Code"] = code;

    const status = statusOptions.includes(row.Status as EmployeeRecord["status"]) ? row.Status as EmployeeRecord["status"] : base.status;
    const employee = normalizeEmployee({ ...base, status, fields });

    if (existing) {
      employees = employees.map(item => item.id === existing.id ? employee : item);
      updated += 1;
    } else {
      employees.push(employee);
      added += 1;
    }
  }

  return { state: { ...state, employees }, added, updated };
}

function parseHtmlRows(text: string) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  return [...doc.querySelectorAll("tr")].map(row => [...row.children].map(cell => cell.textContent ?? ""));
}

function parseDelimitedRows(text: string) {
  const delimiter = text.includes("\t") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      value += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(value);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function cell(value: string) {
  return `<th>${escapeHtml(value)}</th>`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}
