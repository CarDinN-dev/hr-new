import readXlsxFile from "read-excel-file";
import { createEmptyEmployee, employeeImportColumns, normalizeEmployee, statusOptions, type EmployeeRecord, type HrState } from "./data";
import { nextEmployeeCode } from "./domain";

type EmployeeImportColumn = typeof employeeImportColumns[number];

type TemplateColumn = {
  header: string;
  column: EmployeeImportColumn;
};

export type EmployeeWorkbookImport = {
  rows: Array<Record<string, string>>;
  skipped: number;
  errors: string[];
  format: "employee-template" | "master-data" | "generic";
};

// These labels and their order match the employee workbook supplied by HR.
// Position matters because that workbook intentionally reuses labels such as "Issue Date".
export const employeeTemplateColumns: readonly TemplateColumn[] = [
  { header: "Employee Code", column: "Employee Code" },
  { header: "Employee Category", column: "Employee Category" },
  { header: "First Name ", column: "First Name" },
  { header: "Last Name", column: "Last Name" },
  { header: "Full Name", column: "Full Name" },
  { header: "Work Shift", column: "Work Shift" },
  { header: "Company", column: "Company" },
  { header: "Sponsor Name", column: "Sponsor Name" },
  { header: "WPS Sponsor", column: "WPS Sponsor" },
  { header: "LOB", column: "Department" },
  { header: "Designation", column: "Designation" },
  { header: "Grade/Band", column: "Grade/Band" },
  { header: "Date of Birth", column: "Date of Birth" },
  { header: "Joining Date", column: "Joining Date" },
  { header: "Reporting Manager Employee Code/Name", column: "Reporting Manager Employee Code/Name" },
  { header: "Family Status(Yes/No)", column: "Family Status (Yes/No)" },
  { header: "Leave Policy", column: "Leave Policy" },
  { header: "Last rejoin Date ", column: "Last Rejoin Date" },
  { header: "Annual Leave Balance (As on date) ", column: "Annual Leave Balance (As on Date)" },
  { header: "Annual Leave Balance ", column: "Annual Leave Balance" },
  { header: "LOP days( Loss of pay days)", column: "LOP Days (Loss of Pay)" },
  { header: "Business Unit", column: "Business Unit" },
  { header: "Working Company Name", column: "Working Company Name" },
  { header: "Cost Centre", column: "Cost Centre" },
  { header: "Nationality", column: "Nationality" },
  { header: "RP / ID Number", column: "RP/ID Number" },
  { header: "RP/ID Profession", column: "RP/ID Profession" },
  { header: "QID Expiry Date", column: "QID Expiry Date" },
  { header: "Visa Type", column: "Visa Type" },
  { header: "Hire Type", column: "Hire Type" },
  { header: "Confirmation Date", column: "Confirmation Date" },
  { header: "ESB Date", column: "ESB Date" },
  { header: "Gender", column: "Gender" },
  { header: "Marital Status", column: "Marital Status" },
  { header: "Office Mobile No.", column: "Office Mobile No." },
  { header: "Personal Mobile No.", column: "Personal Mobile No." },
  { header: "E-Mail ID (Work)", column: "E-Mail ID (Work)" },
  { header: "No. of Dependents", column: "No. of Dependents" },
  { header: "Blood Group", column: "Blood Group" },
  { header: "Building/Villa #", column: "Local Building/Villa #" },
  { header: "Street #", column: "Local Street #" },
  { header: "Zone #", column: "Local Zone #" },
  { header: "Apartment", column: "International Apartment" },
  { header: "Building", column: "International Building" },
  { header: "Floor", column: "International Floor" },
  { header: "Street", column: "International Street" },
  { header: "State", column: "International State" },
  { header: "Country", column: "International Country" },
  { header: "Zip Code", column: "International Zip Code" },
  { header: "Name", column: "Emergency Contact Name" },
  { header: "Relationship", column: "Emergency Contact Relationship" },
  { header: "Mobile No with country code", column: "Emergency Contact Mobile No." },
  { header: "Travel Sector", column: "Travel Sector" },
  { header: "Travel Cost", column: "Travel Cost" },
  { header: "No. of Tickets Employee (YEAR)", column: "No. of Tickets - Employee (Year)" },
  { header: "Ticket balance (%)", column: "Ticket Balance (%)" },
  { header: "No. Of tickets Family ", column: "No. of Tickets - Family" },
  { header: "Salary Pay Type (Cash/Bank Transfer/Pay Card)", column: "Salary Pay Type" },
  { header: "Company Accommodation", column: "Company Accommodation" },
  { header: "Company  Transportation", column: "Company Transportation" },
  { header: "Overtime", column: "Overtime Eligible" },
  { header: "Company Food", column: "Company Food" },
  { header: "Company Fuel Card", column: "Company Fuel Card" },
  { header: "Work Permit No.", column: "Work Permit No." },
  { header: "Work Permit Issue Date", column: "Work Permit Issue Date" },
  { header: "Work Permit Expiry Date", column: "Work Permit Expiry Date" },
  { header: "Office File No.", column: "Office File No." },
  { header: "Access Card No.", column: "Access Card No." },
  { header: "Bank Code", column: "Bank Code" },
  { header: "IBAN No.", column: "IBAN No." },
  { header: "Account No.", column: "Account No." },
  { header: "Highest Education Qualification ", column: "Highest Education Qualification" },
  { header: "Year of Passing", column: "Year of Passing" },
  { header: "Passport No", column: "Passport No." },
  { header: "Place Of issue", column: "Passport Place of Issue" },
  { header: "Issue Date", column: "Passport Issue Date" },
  { header: "Expiry Date", column: "Passport Expiry Date" },
  { header: "Licenses Type", column: "License Type" },
  { header: "Driving Licenses No", column: "Driving License No." },
  { header: "Expiry Date", column: "Driving License Expiry Date" },
  { header: "Insurance Card No", column: "Insurance Card No." },
  { header: "Issue Date", column: "Insurance Issue Date" },
  { header: "Expiry Date", column: "Insurance Expiry Date" },
  { header: "Basic", column: "Basic" },
  { header: "HRA", column: "HRA" },
  { header: "Food Allowance", column: "Food Allowance" },
  { header: "Mobile Allowance", column: "Mobile Allowance" },
  { header: "Special Allowance", column: "Special Allowance" },
  { header: "Over time", column: "Overtime Amount" },
  { header: "Total", column: "Total" }
];

const canonicalColumnsByHeader = new Map<string, EmployeeImportColumn>(
  employeeImportColumns.map(column => [normalizedHeader(column), column])
);

const legacyColumnsByHeader = new Map<string, EmployeeImportColumn>([
  ["lob", "Department"],
  ["familystatusyesno", "Family Status (Yes/No)"],
  ["rpidnumber", "RP/ID Number"],
  ["salarypaytypecashbanktransferpaycard", "Salary Pay Type"],
  ["companytransportation", "Company Transportation"],
  ["overtime", "Overtime Eligible"],
  ["passportno", "Passport No."],
  ["licensestype", "License Type"]
]);

export function parseEmployeeSheet(text: string) {
  const rows = text.trimStart().startsWith("<") ? parseHtmlRows(text) : parseDelimitedRows(text);
  return recordsFromRows(rows);
}

export async function parseEmployeeWorkbook(file: File): Promise<EmployeeWorkbookImport> {
  const rows = await readXlsxFile(file, { dateFormat: "yyyy-mm-dd" });
  return parseEmployeeWorkbookRows(rows);
}

export function parseEmployeeWorkbookRows(rows: ReadonlyArray<ReadonlyArray<unknown>>): EmployeeWorkbookImport {
  const [headerRow = [], ...body] = rows;
  const headers = headerRow.map(cellText);
  if (isMasterDataWorkbook(headers)) return parseMasterDataWorkbook(body);
  const columns = resolveWorkbookColumns(headers);
  const employeeCodeIndex = columns.findIndex(column => column === "Employee Code");

  if (employeeCodeIndex < 0) {
    throw new Error("The spreadsheet must include the Employee Code column from the Excel template.");
  }

  const parsed: Array<Record<string, string>> = [];
  const errors: string[] = [];
  const employeeCodes = new Set<string>();

  body.forEach((sourceRow, index) => {
    const values = sourceRow.map(cellText);
    if (!values.some(Boolean)) return;

    const employeeCode = values[employeeCodeIndex]?.trim();
    const rowNumber = index + 2;
    if (!employeeCode) {
      errors.push(`Row ${rowNumber} was skipped because Employee Code is blank.`);
      return;
    }

    const codeKey = employeeCode.toLocaleLowerCase();
    if (employeeCodes.has(codeKey)) {
      errors.push(`Row ${rowNumber} was skipped because Employee Code ${employeeCode} is duplicated in this file.`);
      return;
    }
    employeeCodes.add(codeKey);

    const record: Record<string, string> = {};
    columns.forEach((column, columnIndex) => {
      if (column) record[column] = values[columnIndex] ?? "";
    });
    parsed.push(record);
  });

  return { rows: parsed, skipped: errors.length, errors, format: isEmployeeTemplate(headers) ? "employee-template" : "generic" };
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

function resolveWorkbookColumns(headers: string[]) {
  if (isEmployeeTemplate(headers)) return employeeTemplateColumns.map(column => column.column);

  return headers.map(header => {
    const normalized = normalizedHeader(header);
    if (normalized === "status") return "Status";
    return canonicalColumnsByHeader.get(normalized) ?? legacyColumnsByHeader.get(normalized);
  });
}

const masterDataHeaders = [
  "No", "Master Data Name", "WPS Sponsor", "Working Company", "Designation", "LOB", "Date of Joining", "Gender",
  "BASIC", "HRA", "CONVEYANCE", "MOBILE", "Food", "Fuel", "OTHER", "GROSS SALARY"
] as const;

function isEmployeeTemplate(headers: string[]) {
  return headers.length >= employeeTemplateColumns.length && employeeTemplateColumns.every((column, index) => (
    normalizedHeader(headers[index]) === normalizedHeader(column.header)
  ));
}

function isMasterDataWorkbook(headers: string[]) {
  return headers.length >= masterDataHeaders.length && masterDataHeaders.every((header, index) => normalizedHeader(headers[index]) === normalizedHeader(header));
}

function parseMasterDataWorkbook(body: ReadonlyArray<ReadonlyArray<unknown>>): EmployeeWorkbookImport {
  const parsed: Array<Record<string, string>> = [];
  const errors: string[] = [];
  const employeeCodes = new Set<string>();

  body.forEach((sourceRow, index) => {
    const values = sourceRow.map(cellText);
    if (!values.some(Boolean)) return;
    const rowNumber = index + 2;
    const value = (header: typeof masterDataHeaders[number]) => values[masterDataHeaders.indexOf(header)] ?? "";
    const employeeCode = value("No").trim();
    if (!employeeCode) {
      errors.push(`Row ${rowNumber} was skipped because No (Employee Code) is blank.`);
      return;
    }
    const codeKey = employeeCode.toLocaleLowerCase();
    if (employeeCodes.has(codeKey)) {
      errors.push(`Row ${rowNumber} was skipped because Employee Code ${employeeCode} is duplicated in this file.`);
      return;
    }
    employeeCodes.add(codeKey);

    const named = value("Master Data Name").trim();
    const company = value("Working Company").trim();
    const wpsSponsor = value("WPS Sponsor").trim();
    const designation = value("Designation").trim();
    const department = value("LOB").trim();
    const joiningDate = normalizedDate(value("Date of Joining"));
    const gender = value("Gender").trim();
    if (!named) errors.push(`Row ${rowNumber} was skipped because Master Data Name is blank.`);
    if (!company) errors.push(`Row ${rowNumber} was skipped because Working Company is blank.`);
    if (!wpsSponsor) errors.push(`Row ${rowNumber} was skipped because WPS Sponsor is blank.`);
    if (!designation) errors.push(`Row ${rowNumber} was skipped because Designation is blank.`);
    if (!department) errors.push(`Row ${rowNumber} was skipped because LOB is blank.`);
    if (!joiningDate) errors.push(`Row ${rowNumber} was skipped because Date of Joining must be a valid date.`);
    if (!(["Male", "Female", "Other"] as string[]).includes(gender)) errors.push(`Row ${rowNumber} was skipped because Gender must be Male, Female, or Other.`);
    const errorsBeforeAmounts = errors.length;
    const basic = cashAmount(value("BASIC"), "BASIC", rowNumber, errors);
    const hra = componentAmount(value("HRA"), "HRA", rowNumber, errors);
    const conveyance = componentAmount(value("CONVEYANCE"), "CONVEYANCE", rowNumber, errors);
    const mobile = componentAmount(value("MOBILE"), "MOBILE", rowNumber, errors);
    const food = componentAmount(value("Food"), "Food", rowNumber, errors);
    const fuel = componentAmount(value("Fuel"), "Fuel", rowNumber, errors);
    const other = componentAmount(value("OTHER"), "OTHER", rowNumber, errors);
    const gross = cashAmount(value("GROSS SALARY"), "GROSS SALARY", rowNumber, errors);
    if (!named || !company || !wpsSponsor || !designation || !department || !joiningDate || !(["Male", "Female", "Other"] as string[]).includes(gender) || errors.length !== errorsBeforeAmounts) return;

    parsed.push({
      "Employee Code": employeeCode,
      "Full Name": named,
      Company: company,
      "Working Company Name": company,
      "WPS Sponsor": wpsSponsor,
      Department: department,
      Designation: designation,
      "Joining Date": joiningDate,
      Gender: gender,
      Basic: basic.amount,
      HRA: hra.amount,
      "Conveyance Allowance": conveyance.amount,
      "Mobile Allowance": mobile.amount,
      "Food Allowance": food.amount,
      "Fuel Allowance": fuel.amount,
      "Other Allowance": other.amount,
      "Gross Adjustment": decimal(gross.value - basic.value - hra.value - conveyance.value - mobile.value - food.value - fuel.value - other.value),
      Total: gross.amount,
      "Company Conveyance": conveyance.companyProvided ? "Yes" : "No",
      "Company Fuel": fuel.companyProvided ? "Yes" : "No",
      "Company Other": other.companyProvided ? "Yes" : "No"
    });
  });

  return { rows: parsed, skipped: errors.length, errors, format: "master-data" };
}

function cashAmount(value: string, header: string, rowNumber: number, errors: string[]) {
  return componentAmount(value, header, rowNumber, errors, false);
}

function componentAmount(value: string, header: string, rowNumber: number, errors: string[], acceptsCompany = true) {
  const text = value.trim().replaceAll(",", "");
  if (!text) return { amount: "0", value: 0, companyProvided: false };
  if (acceptsCompany && /^(comp|company)$/i.test(text)) return { amount: "0", value: 0, companyProvided: true };
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) {
    errors.push(`Row ${rowNumber} was skipped because ${header} must be a non-negative amount${acceptsCompany ? " or Comp" : ""}.`);
    return { amount: "0", value: 0, companyProvided: false };
  }
  return { amount: decimal(number), value: number, companyProvided: false };
}

function decimal(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function normalizedDate(value: string) {
  const text = value.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/.exec(text);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const parts = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : undefined;
  if (!parts) return "";
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
    : "";
}

function recordsFromRows(rows: string[][]) {
  const [headers = [], ...body] = rows.map(row => row.map(value => value.trim()));
  return body
    .filter(row => row.some(Boolean))
    .map(row => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
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

function cellText(value: unknown) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return value == null ? "" : String(value).trim();
}

function normalizedHeader(value: string) {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
}
