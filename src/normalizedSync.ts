import type { AttendanceCode, EmployeeRecord, HrState } from "./data";
import { apiList, apiRequest, hasAnyPermission, hasPermission, type BackendSession } from "./api";

type BackendRecord = Record<string, unknown>;

export async function persistNormalizedStateDelta(before: HrState, after: HrState, session: BackendSession) {
  const csrfToken = session.csrfToken;
  const request = <T>(path: string, method: string, body?: unknown) => apiRequest<T>(path, {
    method, csrfToken, body: body === undefined ? undefined : JSON.stringify(body)
  });
  const needsEmployees = hasAnyPermission(session, "employee.hr.create", "employee.hr.update", "employee.hr.terminate", "employee.hr.read_sensitive", "payroll.configure", "payroll.update_bank");
  const needsDepartments = hasAnyPermission(session, "department.manage", "employee.hr.create", "employee.hr.update", "recruitment.manage");
  const needsLeaveTypes = hasAnyPermission(session, "leave.configure", "leave.self.create", "leave.hr.manage");
  const [existingDepartments, existingLeaveTypes] = await Promise.all([
    needsDepartments ? apiList<BackendRecord>("/departments") : Promise.resolve([]),
    needsLeaveTypes ? apiList<BackendRecord>("/leave/types") : Promise.resolve([])
  ]);
  await syncSettings(before, after, existingDepartments, existingLeaveTypes, request, session);
  const [departments, leaveTypes, positions, backendEmployees] = await Promise.all([
    needsDepartments ? apiList<BackendRecord>("/departments") : Promise.resolve([]),
    needsLeaveTypes ? apiList<BackendRecord>("/leave/types") : Promise.resolve([]),
    needsEmployees && hasPermission(session, "position.read") ? apiList<BackendRecord>("/job-positions") : Promise.resolve([]),
    needsEmployees && hasAnyPermission(session, "employee.hr.read", "employee.read_all") ? apiList<BackendRecord>("/employees") : Promise.resolve([])
  ]);
  const departmentIds = new Map(departments.map(row => [String(row.name), String(row.id)]));
  const positionIds = new Map(positions.map(row => [`${String(row.departmentId || "")}:${String(row.title)}`, String(row.id)]));
  const managerIds = new Map(backendEmployees.map(row => [String(row.employeeCode), String(row.id)]));
  let synchronizedAfter = after;
  if (needsEmployees) {
    const employeeIdMap = await syncEmployees(before, after, departmentIds, positionIds, managerIds, request, session);
    synchronizedAfter = remapEmployeeIds(after, employeeIdMap);
  }
  if (hasPermission(session, "attendance.hr.manage")) await syncAttendance(before, synchronizedAfter, request);
  if (hasAnyPermission(session, "trip.self.create", "trip.team.approve_manager", "trip.management.approve_manager", "trip.hr.manage")) await syncTrips(before, synchronizedAfter, request);
  if (hasAnyPermission(session, "expense.self.create", "expense.team.approve_manager", "expense.management.approve_manager", "expense.hr.approve")) await syncExpenses(before, synchronizedAfter, request);
  if (hasPermission(session, "loan.hr.manage")) await syncLoans(before, synchronizedAfter, request);
  if (hasPermission(session, "recruitment.manage")) await syncRecruitment(before, synchronizedAfter, departmentIds, request);
  if (hasPermission(session, "eos.manage")) await syncEos(before, synchronizedAfter, request);
  if (hasAnyPermission(session, "document.self.manage", "document.hr.manage")) await syncDocuments(before, synchronizedAfter, session);
}

type RequestFn = <T>(path: string, method: string, body?: unknown) => Promise<T>;

async function syncEmployees(before: HrState, after: HrState, departmentIds: Map<string, string>, positionIds: Map<string, string>, managerIds: Map<string, string>, request: RequestFn, session: BackendSession) {
  const idMap = new Map<string, string>();
  const previous = byId(before.employees);
  const current = byId(after.employees);
  const canCreate = hasPermission(session, "employee.hr.create");
  const canUpdate = hasPermission(session, "employee.hr.update");
  const canUpdateSensitive = canUpdate && hasPermission(session, "employee.hr.read_sensitive");
  const canTerminate = hasPermission(session, "employee.hr.terminate");
  const canConfigureSalary = hasPermission(session, "payroll.configure");
  const canUpdateBank = hasPermission(session, "payroll.update_bank");
  for (const employee of after.employees) {
    const old = previous.get(employee.id);
    if (!old && canCreate) {
      const created = await request<BackendRecord>("/employees", "POST", employeeCorePayload(employee, departmentIds, positionIds, managerIds));
      const employeeId = String(created.id);
      idMap.set(employee.id, employeeId);
      managerIds.set(employee.fields["Employee Code"], employeeId);
      if (canUpdateSensitive) await request(`/employees/${employeeId}/details`, "PATCH", employeeDetailsPayload(employee));
      if (canUpdateBank) await request(`/employees/${employeeId}/bank`, "PATCH", employeeBankPayload(employee));
      if (canConfigureSalary) await request("/payroll/salary-records", "POST", salaryRecordPayload(employeeId, employee));
    } else if (old) {
      if (canUpdate && !same(employeeCorePayload(old, departmentIds, positionIds, managerIds), employeeCorePayload(employee, departmentIds, positionIds, managerIds))) {
        await request(`/employees/${employee.id}`, "PATCH", employeeCorePayload(employee, departmentIds, positionIds, managerIds));
      }
      if (canUpdateSensitive && !same(employeeDetailsPayload(old), employeeDetailsPayload(employee))) {
        await request(`/employees/${employee.id}/details`, "PATCH", employeeDetailsPayload(employee));
      }
      if (canUpdateBank && !same(employeeBankPayload(old), employeeBankPayload(employee))) {
        await request(`/employees/${employee.id}/bank`, "PATCH", employeeBankPayload(employee));
      }
      if (canConfigureSalary && !same(employeeSalaryPayload(old), employeeSalaryPayload(employee))) {
        const records = await apiList<BackendRecord>(`/payroll/salary-records?employeeId=${encodeURIComponent(employee.id)}`);
        const currentSalary = records.find(record => !record.effectiveTo && !record.deletedAt);
        if (currentSalary) await request(`/payroll/salary-records/${currentSalary.id}`, "PATCH", employeeSalaryPayload(employee));
        else await request("/payroll/salary-records", "POST", salaryRecordPayload(employee.id, employee));
      }
    }
  }
  if (canTerminate) for (const employee of before.employees) if (!current.has(employee.id)) await request(`/employees/${employee.id}`, "DELETE");
  return idMap;
}

export function employeeDetailsPayload(employee: EmployeeRecord) {
  const f = employee.fields;
  const yes = (field: string) => f[field] === "Yes";
  const credential = (type: string, number: string, profession?: string, placeOfIssue?: string, issueDate?: string, expiryDate?: string) => deepCompact({ type, number: f[number], profession: profession ? f[profession] : undefined, placeOfIssue: placeOfIssue ? f[placeOfIssue] : undefined, issueDate: issueDate ? f[issueDate] : undefined, expiryDate: expiryDate ? f[expiryDate] : undefined });
  const credentials = [
    credential("QID", "RP/ID Number", "RP/ID Profession", undefined, undefined, "QID Expiry Date"),
    credential("WORK_PERMIT", "Work Permit No.", undefined, undefined, "Work Permit Issue Date", "Work Permit Expiry Date"),
    credential("PASSPORT", "Passport No.", undefined, "Passport Place of Issue", "Passport Issue Date", "Passport Expiry Date"),
    credential("DRIVING_LICENSE", "Driving License No.", "License Type", undefined, undefined, "Driving License Expiry Date"),
    credential("INSURANCE", "Insurance Card No.", undefined, undefined, "Insurance Issue Date", "Insurance Expiry Date")
  ].filter(item => Object.keys(item).some(key => key !== "type"));
  return deepCompact({
    dateOfBirth: f["Date of Birth"] || undefined,
    gender: ({ Male: "MALE", Female: "FEMALE", Other: "OTHER" } as const)[f.Gender as "Male" | "Female" | "Other"],
    emergencyContactName: f["Emergency Contact Name"] || undefined,
    emergencyContactPhone: f["Emergency Contact Mobile No."] || undefined,
    profile: {
      employeeCategory: f["Employee Category"], workShift: f["Work Shift"], company: f.Company, sponsorName: f["Sponsor Name"], wpsSponsor: f["WPS Sponsor"],
      gradeBand: f["Grade/Band"], familyStatus: f["Family Status (Yes/No)"], leavePolicy: f["Leave Policy"], lastRejoinDate: f["Last Rejoin Date"],
      businessUnit: f["Business Unit"], workingCompanyName: f["Working Company Name"], costCentre: f["Cost Centre"], nationality: f.Nationality,
      residenceProfession: f["RP/ID Profession"], visaType: f["Visa Type"], hireType: f["Hire Type"], confirmationDate: f["Confirmation Date"], esbDate: f["ESB Date"],
      maritalStatus: f["Marital Status"], officeMobile: f["Office Mobile No."], personalMobile: f["Personal Mobile No."], dependents: Number(f["No. of Dependents"] || 0), bloodGroup: f["Blood Group"],
      localBuilding: f["Local Building/Villa #"], localStreet: f["Local Street #"], localZone: f["Local Zone #"], internationalApartment: f["International Apartment"],
      internationalBuilding: f["International Building"], internationalFloor: f["International Floor"], internationalStreet: f["International Street"], internationalState: f["International State"],
      internationalCountry: f["International Country"], internationalZipCode: f["International Zip Code"], emergencyRelationship: f["Emergency Contact Relationship"],
      salaryPayType: f["Salary Pay Type"], officeFileNumber: f["Office File No."], accessCardNumber: f["Access Card No."]
    },
    benefits: {
      travelSector: f["Travel Sector"], travelCost: money(f["Travel Cost"]), employeeTicketsPerYear: Number(f["No. of Tickets - Employee (Year)"] || 0),
      ticketBalancePercent: money(f["Ticket Balance (%)"]), familyTickets: Number(f["No. of Tickets - Family"] || 0), companyAccommodation: yes("Company Accommodation"),
      companyTransportation: yes("Company Transportation"), overtimeEligible: yes("Overtime Eligible"), companyFood: yes("Company Food"), companyFuelCard: yes("Company Fuel Card")
    },
    credentials,
    education: f["Highest Education Qualification"] ? [{ qualification: f["Highest Education Qualification"], yearOfPassing: Number(f["Year of Passing"] || 0) || undefined }] : []
  });
}

export function employeeCorePayload(employee: EmployeeRecord, departmentIds: Map<string, string>, positionIds = new Map<string, string>(), managerIds = new Map<string, string>()) {
  const f = employee.fields;
  const status = ({ Active: "ACTIVE", "On Leave": "ON_LEAVE", Resigned: "RESIGNED", Terminated: "TERMINATED" } as const)[employee.status];
  const departmentId = departmentIds.get(f.Department);
  const managerCode = managerEmployeeCode(employee);
  return compact({
    employeeCode: f["Employee Code"], firstName: f["First Name"], lastName: f["Last Name"],
    email: f["E-Mail ID (Work)"] || `${f["Employee Code"]}@legacy.invalid`, phone: f["Personal Mobile No."] || f["Office Mobile No."],
    hireDate: f["Joining Date"], employmentStatus: status, departmentId,
    positionId: positionIds.get(`${departmentId ?? ""}:${f.Designation}`), managerId: managerCode ? managerIds.get(managerCode) : undefined,
    photo: employee.photo || undefined
  });
}

export function employeeBankPayload(employee: EmployeeRecord) {
  const fields = employee.fields;
  return compact({ bankCode: fields["Bank Code"], iban: fields["IBAN No."], accountNumber: fields["Account No."] });
}

export function employeeSalaryPayload(employee: EmployeeRecord) {
  const fields = employee.fields;
  return {
    baseSalary: money(fields.Basic),
    allowances: money(fields.HRA) + money(fields["Food Allowance"]) + money(fields["Mobile Allowance"]) + money(fields["Special Allowance"]),
    housingAllowance: money(fields.HRA), foodAllowance: money(fields["Food Allowance"]), mobileAllowance: money(fields["Mobile Allowance"]),
    specialAllowance: money(fields["Special Allowance"]), overtimeAmount: money(fields["Overtime Amount"]),
    bonuses: money(fields["Overtime Amount"]),
    deductions: 0,
    taxRate: 0
  };
}

export function salaryRecordPayload(employeeId: string, employee: EmployeeRecord) {
  return { employeeId, ...employeeSalaryPayload(employee), effectiveFrom: employee.fields["Joining Date"] || new Date().toISOString().slice(0, 10) };
}

export function employeeImportRowPayload(employee: EmployeeRecord, departmentIds: Map<string, string>, positionIds: Map<string, string>) {
  const core = employeeCorePayload(employee, departmentIds, positionIds);
  delete (core as Record<string, unknown>).managerId;
  return {
    ...core,
    sourceId: employee.id,
    managerEmployeeCode: managerEmployeeCode(employee) || undefined,
    details: employeeDetailsPayload(employee),
    bank: employeeBankPayload(employee),
    salaryRecord: { ...employeeSalaryPayload(employee), effectiveFrom: employee.fields["Joining Date"] || new Date().toISOString().slice(0, 10) }
  };
}

async function syncAttendance(before: HrState, after: HrState, request: RequestFn) {
  const keys = new Set([...attendanceKeys(before), ...attendanceKeys(after)]);
  const changes = [...keys].map(key => {
    const [day, employeeId] = splitAttendanceKey(key);
    const oldCode = before.attendance[day]?.[employeeId];
    const nextCode = after.attendance[day]?.[employeeId];
    const oldApproval = before.attendanceApprovals[day]?.[employeeId];
    const nextApproval = after.attendanceApprovals[day]?.[employeeId];
    return { key, day, employeeId, nextCode, nextApproval, changed: oldCode !== nextCode || oldApproval !== nextApproval };
  }).filter(change => change.changed);
  if (!changes.length) return;
  const days = [...new Set(changes.map(change => change.day))];
  const backend = (await Promise.all(days.map(day => apiList<BackendRecord>(`/attendance?dateFrom=${encodeURIComponent(day)}&dateTo=${encodeURIComponent(day)}`)))).flat();
  const records = new Map(backend.map(row => [`${dateOnly(row.attendanceDate)}:${row.employeeId}`, row]));
  for (const { key, day, employeeId, nextCode, nextApproval } of changes) {
    const existing = records.get(key);
    if (!nextCode) {
      if (existing) await request(`/attendance/${existing.id}`, "DELETE");
      continue;
    }
    const payload = {
      employeeId, attendanceDate: day, status: attendanceStatus(nextCode),
      approvalStatus: nextApproval === "Approved" ? "APPROVED" : "NOT_APPROVED",
      correctionReason: existing ? "Attendance updated in HR console" : undefined
    };
    if (existing) await request(`/attendance/${existing.id}`, "PATCH", payload);
    else await request("/attendance", "POST", payload);
  }
}

async function syncTrips(before: HrState, after: HrState, request: RequestFn) {
  const previous = byId(before.businessTrips); const current = byId(after.businessTrips);
  for (const trip of after.businessTrips) {
    const old = previous.get(trip.id);
    if (!old) await request("/business-trips", "POST", { employeeId: trip.employeeId, destination: trip.destination, purpose: trip.purpose, startDate: trip.from, endDate: trip.to, perDiem: String(trip.perDiem), travelCost: String(trip.travelCost), advanceAmount: String(trip.advanceAmount) });
    else if (old.status !== trip.status) await request(`/business-trips/${trip.id}/status`, "PATCH", { status: enumValue(trip.status) });
  }
  for (const trip of before.businessTrips) if (!current.has(trip.id)) await request(`/business-trips/${trip.id}`, "DELETE");
}

async function syncExpenses(before: HrState, after: HrState, request: RequestFn) {
  const previous = byId(before.expenses); const current = byId(after.expenses);
  for (const expense of after.expenses) {
    const old = previous.get(expense.id);
    if (!old) await request("/expenses", "POST", { employeeId: expense.employeeId, tripId: expense.tripId, category: expense.category, expenseDate: expense.date, amount: String(expense.amount), description: expense.description });
    else if (old.status !== expense.status) await request(`/expenses/${expense.id}/status`, "PATCH", { status: enumValue(expense.status) });
  }
  for (const expense of before.expenses) if (!current.has(expense.id)) await request(`/expenses/${expense.id}`, "DELETE");
}

async function syncLoans(before: HrState, after: HrState, request: RequestFn) {
  const previous = byId(before.loans);
  for (const loan of after.loans) {
    const old = previous.get(loan.id);
    if (!old) {
      const [startYear, startMonth] = loan.startPeriod.split("-").map(Number);
      await request("/loans", "POST", { employeeId: loan.employeeId, type: loan.type, principal: String(loan.principal), disbursementDate: loan.disbursementDate, startYear, startMonth, repaymentMode: enumValue(loan.repaymentMode), termMonths: loan.termMonths, monthlyLimit: String(loan.monthlyLimit), reference: loan.reference || undefined, notes: loan.notes || undefined });
      continue;
    }
    if (old.status !== loan.status && loan.status === "Active") await request(`/loans/${loan.id}/activate`, "PATCH");
    for (const [period, override] of Object.entries(loan.deductionOverrides)) if (!same(old.deductionOverrides[period], override)) {
      const [year, month] = period.split("-").map(Number);
      await request(`/loans/${loan.id}/overrides`, "POST", { year, month, amount: String(override.amount), reason: override.reason, approvedAboveLimit: override.approvedAboveLimit });
    }
  }
  const previousRepayments = byId(before.loanRepayments);
  for (const repayment of after.loanRepayments) if (!previousRepayments.has(repayment.id) && repayment.source === "Manual") {
    await request(`/loans/${repayment.loanId}/repayments`, "POST", { year: repayment.year, month: repayment.month, amount: String(repayment.amount), note: repayment.note || undefined });
  }
}

async function syncRecruitment(before: HrState, after: HrState, departmentIds: Map<string, string>, request: RequestFn) {
  const oldJobs = byId(before.jobs); const currentJobs = byId(after.jobs);
  for (const job of after.jobs) {
    const old = oldJobs.get(job.id);
    const payload = { title: job.title, departmentId: departmentIds.get(job.dept), openings: job.openings, postedOn: job.postedOn, description: job.description || undefined, status: enumValue(job.status) };
    if (!old) await request("/recruitment/jobs", "POST", { ...payload, status: undefined });
    else if (!same({ ...payload, status: enumValue(old.status), title: old.title, departmentId: departmentIds.get(old.dept), openings: old.openings, postedOn: old.postedOn, description: old.description || undefined }, payload)) await request(`/recruitment/jobs/${job.id}`, "PATCH", payload);
  }
  const oldCandidates = byId(before.candidates); const current = byId(after.candidates);
  for (const candidate of after.candidates) {
    const old = oldCandidates.get(candidate.id);
    const payload = { jobId: candidate.jobId, name: candidate.name, email: candidate.email, phone: candidate.phone || undefined, rating: String(candidate.rating), notes: candidate.notes || undefined, appliedOn: candidate.appliedOn };
    if (!old) await request("/recruitment/candidates", "POST", payload);
    else {
      const oldPayload = { jobId: old.jobId, name: old.name, email: old.email, phone: old.phone || undefined, rating: String(old.rating), notes: old.notes || undefined, appliedOn: old.appliedOn };
      if (!same(oldPayload, payload)) await request(`/recruitment/candidates/${candidate.id}`, "PATCH", payload);
    }
    if (old && old.stage !== candidate.stage) {
      const stages = ["Applied", "Screening", "Interview", "Offer", "Hired"];
      const oldIndex = stages.indexOf(old.stage);
      const nextIndex = stages.indexOf(candidate.stage);
      if (candidate.stage === "Rejected") {
        await request(`/recruitment/candidates/${candidate.id}/stage`, "PATCH", { stage: "REJECTED" });
      } else if (oldIndex >= 0 && nextIndex > oldIndex) {
        for (let index = oldIndex + 1; index <= nextIndex; index += 1) {
          await request(`/recruitment/candidates/${candidate.id}/stage`, "PATCH", { stage: enumValue(stages[index]) });
        }
      } else {
        throw new Error("Candidate stages can only move forward or be rejected.");
      }
    }
    if (old && candidate.stage === "Hired" && candidate.employeeId && candidate.employeeId !== old.employeeId) {
      await request(`/recruitment/candidates/${candidate.id}/stage`, "PATCH", { stage: "HIRED", employeeId: candidate.employeeId });
    }
  }
  for (const candidate of before.candidates) if (!current.has(candidate.id)) await request(`/recruitment/candidates/${candidate.id}`, "DELETE");
  for (const job of before.jobs) if (!currentJobs.has(job.id)) await request(`/recruitment/jobs/${job.id}`, "DELETE");
}

async function syncEos(before: HrState, after: HrState, request: RequestFn) {
  const previous = byId(before.eosRecords); const current = byId(after.eosRecords);
  for (const eos of after.eosRecords) {
    const old = previous.get(eos.id);
    if (!old) await request("/eos", "POST", { employeeId: eos.employeeId, asOf: eos.asOf, reason: eos.reason });
    else if (old.status !== eos.status) await request(`/eos/${eos.id}/status`, "PATCH", { status: enumValue(eos.status) });
  }
  for (const eos of before.eosRecords) if (!current.has(eos.id)) await request(`/eos/${eos.id}`, "DELETE");
}

async function syncSettings(before: HrState, after: HrState, departments: BackendRecord[], leaveTypes: BackendRecord[], request: RequestFn, session: BackendSession) {
  if (hasPermission(session, "system.configure") && (!same(before.settings.company, after.settings.company) || before.settings.workdayHours !== after.settings.workdayHours || before.settings.halfDayHours !== after.settings.halfDayHours || !same(before.settings.loanDeductionCap, after.settings.loanDeductionCap))) {
    const company = after.settings.company;
    await request("/organization-settings", "PATCH", { ...company, workdayHours: String(after.settings.workdayHours), halfDayHours: String(after.settings.halfDayHours), loanCapType: enumValue(after.settings.loanDeductionCap.type), loanCapValue: String(after.settings.loanDeductionCap.value) });
  }
  if (hasPermission(session, "department.manage")) {
    const backendDepartments = new Map(departments.map(row => [String(row.name), String(row.id)]));
    for (const name of after.settings.departments) if (!backendDepartments.has(name)) await request("/departments", "POST", { name, code: uniqueCode(name, departments) });
    for (const [name, id] of backendDepartments) if (!after.settings.departments.includes(name)) await request(`/departments/${id}`, "DELETE");
  }
  if (hasPermission(session, "leave.configure")) {
    const backendTypes = new Map(leaveTypes.map(row => [String(row.id), row]));
    for (const type of after.settings.leaveTypes) {
      const old = backendTypes.get(type.id);
      if (!old) await request("/leave/types", "POST", { name: type.name, code: uniqueCode(type.name, [...backendTypes.values()]), annualAllowanceDays: type.days, isPaid: !type.name.toLowerCase().includes("unpaid") });
      else if (String(old.name) !== type.name || Number(old.annualAllowanceDays) !== type.days) await request(`/leave/types/${type.id}`, "PATCH", { name: type.name, annualAllowanceDays: type.days });
    }
    for (const [id] of backendTypes) if (!after.settings.leaveTypes.some(type => type.id === id)) await request(`/leave/types/${id}`, "DELETE");
  }
}

async function syncDocuments(before: HrState, after: HrState, session: BackendSession) {
  const previous = byId(before.documents); const current = byId(after.documents);
  for (const document of after.documents) if (!previous.has(document.id) && document.dataUrl && document.employeeId) {
    const response = await fetch(document.dataUrl); const blob = await response.blob();
    const body = new FormData();
    body.set("employeeId", document.employeeId); body.set("documentType", document.template); body.set("visibility", "HR_ONLY");
    body.set("file", new File([blob], document.filename || `${document.documentNumber}.pdf`, { type: blob.type || "application/pdf" }));
    await apiRequest("/documents/upload", { method: "POST", csrfToken: session.csrfToken, body });
  }
  for (const document of before.documents) if (!current.has(document.id)) await apiRequest(`/documents/${document.id}`, { method: "DELETE", csrfToken: session.csrfToken });
}

function byId<T extends { id: string }>(items: T[]) { return new Map(items.map(item => [item.id, item])); }
function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }
function compact<T extends Record<string, unknown>>(record: T) { return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== "" && value !== undefined && value !== null)); }
function deepCompact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
    if (item === "" || item === undefined || item === null) return [];
    if (Array.isArray(item)) return [[key, item.map(entry => entry && typeof entry === "object" ? deepCompact(entry as Record<string, unknown>) : entry)]];
    if (typeof item === "object" && !(item instanceof Date)) return [[key, deepCompact(item as Record<string, unknown>)]];
    return [[key, item]];
  }));
}
function managerEmployeeCode(employee: EmployeeRecord) {
  const value = employee.fields["Reporting Manager Employee Code/Name"].trim();
  return value ? value.split(/\s+-\s+|\s+/u)[0] : "";
}
export function remapEmployeeIds(state: HrState, ids: Map<string, string>): HrState {
  if (!ids.size) return state;
  const employeeId = (id: string) => ids.get(id) ?? id;
  const recordMap = <T>(records: Record<string, T>) => Object.fromEntries(Object.entries(records).map(([id, value]) => [employeeId(id), value]));
  return {
    ...state,
    employees: state.employees.map(employee => ({ ...employee, id: employeeId(employee.id) })),
    attendance: Object.fromEntries(Object.entries(state.attendance).map(([day, records]) => [day, recordMap(records)])),
    attendanceApprovals: Object.fromEntries(Object.entries(state.attendanceApprovals).map(([day, records]) => [day, recordMap(records)])),
    leaves: state.leaves.map(item => ({ ...item, employeeId: employeeId(item.employeeId) })),
    payroll: state.payroll.map(item => ({ ...item, employeeId: employeeId(item.employeeId) })),
    businessTrips: state.businessTrips.map(item => ({ ...item, employeeId: employeeId(item.employeeId) })),
    expenses: state.expenses.map(item => ({ ...item, employeeId: employeeId(item.employeeId) })),
    loans: state.loans.map(item => ({ ...item, employeeId: employeeId(item.employeeId) })),
    candidates: state.candidates.map(item => ({ ...item, employeeId: item.employeeId ? employeeId(item.employeeId) : undefined })),
    eosRecords: state.eosRecords.map(item => ({ ...item, employeeId: employeeId(item.employeeId) })),
    documents: state.documents.map(item => ({ ...item, employeeId: item.employeeId ? employeeId(item.employeeId) : "" }))
  };
}
function enumValue(value: string) { return value.toUpperCase().replace(/[\s-]+/g, "_"); }
function money(value: string) { const parsed = Number(String(value || 0).replace(/[^\d.-]/g, "")); return Number.isFinite(parsed) ? parsed : 0; }
function dateOnly(value: unknown) { return String(value || "").slice(0, 10); }
function attendanceKeys(state: HrState) { return Object.entries(state.attendance).flatMap(([day, rows]) => Object.keys(rows).map(employeeId => `${day}:${employeeId}`)); }
function splitAttendanceKey(key: string) { return [key.slice(0, 10), key.slice(11)] as const; }
function attendanceStatus(code: AttendanceCode) { return ({ P: "PRESENT", H: "HALF_DAY", L: "ON_LEAVE", A: "ABSENT" } as const)[code]; }
function uniqueCode(name: string, rows: BackendRecord[]) { const base = enumValue(name).replace(/[^A-Z0-9]/g, "").slice(0, 12) || "DEPT"; const used = new Set(rows.map(row => String(row.code))); let code = base; let suffix = 1; while (used.has(code)) code = `${base.slice(0, 9)}${suffix++}`; return code; }
