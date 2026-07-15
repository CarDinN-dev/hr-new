/* eslint-disable no-console */
const { createHash, randomUUID } = require('node:crypto');
const { PrismaClient, Prisma } = require('@prisma/client');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const decimal = (value = 0) => new Prisma.Decimal(String(value || 0).replace(/[^\d.-]/g, '') || '0').toDecimalPlaces(2);
const date = (value) => {
  const raw = String(value ?? '').trim();
  if (!raw) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}/.test(raw)
    ? new Date(`${raw.slice(0, 10)}T00:00:00.000Z`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};
const enumValue = (value) => String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
const present = (value) => value === '' || value == null ? undefined : value;
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));

function employeeData(row, departments) {
  const f = row.fields || {};
  const code = String(f['Employee Code'] || '').trim();
  const firstName = String(f['First Name'] || f['Full Name'] || '').trim().split(/\s+/)[0] || 'Legacy';
  const lastName = String(f['Last Name'] || '').trim() || String(f['Full Name'] || '').trim().split(/\s+/).slice(1).join(' ');
  const email = String(f['E-Mail ID (Work)'] || `${code || row.id}@legacy.invalid`).trim().toLowerCase();
  const status = { ACTIVE: 'ACTIVE', ON_LEAVE: 'ON_LEAVE', RESIGNED: 'RESIGNED', TERMINATED: 'TERMINATED' }[enumValue(row.status)] || 'ACTIVE';
  const gender = { MALE: 'MALE', FEMALE: 'FEMALE', OTHER: 'OTHER' }[enumValue(f.Gender)];
  return {
    id: row.id, employeeCode: code, firstName, lastName, email,
    phone: present(f['Personal Mobile No.'] || f['Office Mobile No.']),
    dateOfBirth: date(f['Date of Birth']), gender,
    address: present([f['Local Building/Villa #'], f['Local Street #'], f['Local Zone #']].filter(Boolean).join(', ')),
    hireDate: date(f['Joining Date']), employmentStatus: status,
    departmentId: departments.get(String(f.Department || '').trim()), salary: decimal(f.Basic),
    emergencyContactName: present(f['Emergency Contact Name']), emergencyContactPhone: present(f['Emergency Contact Mobile No.']),
  };
}

function profileData(row) {
  const f = row.fields || {};
  return {
    employeeCategory: present(f['Employee Category']), workShift: present(f['Work Shift']), company: present(f.Company),
    sponsorName: present(f['Sponsor Name']), wpsSponsor: present(f['WPS Sponsor']), gradeBand: present(f['Grade/Band']),
    familyStatus: present(f['Family Status (Yes/No)']), leavePolicy: present(f['Leave Policy']), lastRejoinDate: date(f['Last Rejoin Date']),
    businessUnit: present(f['Business Unit']), workingCompanyName: present(f['Working Company Name']), costCentre: present(f['Cost Centre']),
    nationality: present(f.Nationality), residenceProfession: present(f['RP/ID Profession']), visaType: present(f['Visa Type']),
    hireType: present(f['Hire Type']), confirmationDate: date(f['Confirmation Date']), esbDate: date(f['ESB Date']),
    maritalStatus: present(f['Marital Status']), officeMobile: present(f['Office Mobile No.']), personalMobile: present(f['Personal Mobile No.']),
    dependents: present(f['No. of Dependents']) === undefined ? undefined : number(f['No. of Dependents']), bloodGroup: present(f['Blood Group']),
    localBuilding: present(f['Local Building/Villa #']), localStreet: present(f['Local Street #']), localZone: present(f['Local Zone #']),
    internationalApartment: present(f['International Apartment']), internationalBuilding: present(f['International Building']),
    internationalFloor: present(f['International Floor']), internationalStreet: present(f['International Street']),
    internationalState: present(f['International State']), internationalCountry: present(f['International Country']), internationalZipCode: present(f['International Zip Code']),
    emergencyRelationship: present(f['Emergency Contact Relationship']), salaryPayType: present(f['Salary Pay Type']),
    officeFileNumber: present(f['Office File No.']), accessCardNumber: present(f['Access Card No.']),
  };
}

async function run() {
  const source = await prisma.hrConsoleState.findFirst({ orderBy: { updatedAt: 'desc' } });
  if (!source) throw new Error('No legacy console state was found. Nothing to import.');
  const state = source.data || {};
  const sourceHash = hash(state);
  const prior = await prisma.importRun.findUnique({ where: { sourceHash }, include: { items: true } });
  if (prior?.status === 'APPLIED') {
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', idempotent: true, run: prior }, null, 2));
    return;
  }

  const report = [];
  const add = (entityType, legacyId, status, reason, targetId = legacyId, value = {}) => report.push({ entityType, legacyId, targetId, sourceHash: hash({ legacyId, value }), status, reason });
  const arrays = ['employees', 'leaves', 'payroll', 'businessTrips', 'expenses', 'loans', 'loanRepayments', 'jobs', 'candidates', 'eosRecords', 'documents'];
  for (const key of arrays) if (!Array.isArray(state[key])) add('Workspace', key, 'INVALID', `${key} must be an array`, undefined, state[key]);
  if (!state.settings || typeof state.settings !== 'object') add('Workspace', 'settings', 'INVALID', 'settings must be an object', undefined, state.settings);

  const employees = Array.isArray(state.employees) ? state.employees : [];
  for (const row of employees) {
    const f = row?.fields || {};
    if (!row?.id || !String(f['Employee Code'] || '').trim() || !date(f['Joining Date'])) {
      add('Employee', row?.id, 'INVALID', 'id, employee code, and joining date are required', undefined, row);
    }
  }
  const duplicates = new Map();
  for (const row of employees) {
    const code = String(row?.fields?.['Employee Code'] || '').trim().toLowerCase();
    const email = String(row?.fields?.['E-Mail ID (Work)'] || '').trim().toLowerCase();
    for (const key of [code && `code:${code}`, email && `email:${email}`].filter(Boolean)) {
      if (duplicates.has(key)) add('Employee', row.id, 'CONFLICT', `Duplicate legacy ${key}`, undefined, row);
      else duplicates.set(key, row.id);
    }
  }

  const [targetEmployees, targetLoans, targetJobs, targetLeaveTypes] = await Promise.all([
    prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, employeeCode: true, email: true } }),
    prisma.employeeLoan.findMany({ where: { deletedAt: null }, select: { id: true } }),
    prisma.recruitmentJob.findMany({ where: { deletedAt: null }, select: { id: true } }),
    prisma.leaveType.findMany({ where: { deletedAt: null }, select: { id: true, name: true } }),
  ]);
  const employeeIds = new Set([...targetEmployees.map((row) => row.id), ...employees.map((row) => row?.id).filter(Boolean)]);
  const loanIds = new Set([...targetLoans.map((row) => row.id), ...(Array.isArray(state.loans) ? state.loans.map((row) => row?.id).filter(Boolean) : [])]);
  const jobIds = new Set([...targetJobs.map((row) => row.id), ...(Array.isArray(state.jobs) ? state.jobs.map((row) => row?.id).filter(Boolean) : [])]);
  const leaveTypeNames = new Set([
    ...targetLeaveTypes.map((row) => row.name.toLowerCase()),
    ...(state.settings?.leaveTypes || []).map((row) => String(row?.name || '').toLowerCase()).filter(Boolean),
  ]);
  for (const row of employees) {
    const data = employeeData(row, new Map());
    const conflict = targetEmployees.find((target) => target.id !== data.id && (
      target.employeeCode.toLowerCase() === data.employeeCode.toLowerCase() || target.email.toLowerCase() === data.email.toLowerCase()
    ));
    if (conflict) add('Employee', row.id, 'CONFLICT', 'Employee code or email belongs to another normalized record', conflict.id, row);
  }
  const requireEmployee = (entityType, rows) => {
    for (const row of rows || []) if (!employeeIds.has(row?.employeeId)) add(entityType, row?.id, 'INVALID', 'Employee not found', undefined, row);
  };
  requireEmployee('LeaveRequest', state.leaves);
  for (const row of state.leaves || []) if (!leaveTypeNames.has(String(row?.type || '').toLowerCase())) add('LeaveRequest', row?.id, 'INVALID', 'Leave type not found', undefined, row);
  requireEmployee('Payroll', state.payroll);
  requireEmployee('BusinessTrip', state.businessTrips);
  requireEmployee('EmployeeExpense', state.expenses);
  requireEmployee('EmployeeLoan', state.loans);
  requireEmployee('EosRecord', state.eosRecords);
  requireEmployee('EmployeeDocument', state.documents);
  for (const rows of Object.values(state.attendance || {})) for (const employeeId of Object.keys(rows || {})) {
    if (!employeeIds.has(employeeId)) add('Attendance', employeeId, 'INVALID', 'Employee not found', undefined, { employeeId });
  }
  for (const row of state.loanRepayments || []) if (!loanIds.has(row?.loanId)) add('LoanRepayment', row?.id, 'INVALID', 'Loan not found', undefined, row);
  for (const row of state.candidates || []) if (!jobIds.has(row?.jobId)) add('RecruitmentCandidate', row?.id, 'INVALID', 'Recruitment job not found', undefined, row);
  for (const row of state.documents || []) if (row?.dataUrl) add('EmployeeDocument', row.id, 'INVALID', 'Embedded document content requires GCS object migration before metadata import', undefined, row);

  if (!apply) {
    const inventory = Object.fromEntries(arrays.map((key) => [key, Array.isArray(state[key]) ? state[key].length : 0]));
    const counts = report.reduce((out, item) => ({ ...out, [item.status.toLowerCase()]: (out[item.status.toLowerCase()] || 0) + 1 }), {});
    console.log(JSON.stringify({ mode: 'dry-run', sourceUpdatedAt: source.updatedAt, sourceHash, inventory, preflight: counts, items: report }, null, 2));
    return;
  }
  if (report.some((item) => item.status === 'INVALID' || item.status === 'CONFLICT')) {
    throw new Error(`Import preflight failed: ${JSON.stringify(report)}`);
  }

  const result = await prisma.$transaction(async (tx) => {
    const run = await tx.importRun.create({ data: { sourceStateUpdatedAt: source.updatedAt, sourceHash, status: 'APPLIED' } });
    const created = async (entityType, legacyId, value, exists, create) => {
      const itemHash = hash(value);
      if (await exists()) {
        add(entityType, legacyId, 'SKIPPED', 'Target already exists', legacyId, value);
        return;
      }
      await create();
      add(entityType, legacyId, 'CREATED', undefined, legacyId, value);
    };

    const settings = state.settings || {};
    const company = settings.company || {};
    const orgData = {
      id: 'default', name: company.name || 'MedTech', legalName: company.legalName || company.name || 'MedTech', tagline: present(company.tagline),
      address: present(company.address), phone: present(company.phone), email: present(company.email), website: present(company.website), currency: company.currency || 'QAR',
      wpsEmployerEid: present(company.wpsEmployerEid), wpsPayerEid: present(company.wpsPayerEid), wpsPayerQid: present(company.wpsPayerQid),
      wpsPayerBank: present(company.wpsPayerBank), wpsPayerIban: present(company.wpsPayerIban), accountPhoto: present(company.accountPhoto), workdayHours: decimal(settings.workdayHours || 8),
      halfDayHours: decimal(settings.halfDayHours || 4), loanCapType: enumValue(settings.loanDeductionCap?.type || 'AMOUNT'),
      loanCapValue: decimal(settings.loanDeductionCap?.value),
    };
    await created('OrganizationSettings', 'default', orgData, () => tx.organizationSettings.findUnique({ where: { id: 'default' } }), () => tx.organizationSettings.create({ data: orgData }));
    await tx.documentSequence.upsert({ where: { key: 'employee_document' }, create: { key: 'employee_document', value: number(settings.documentSeq) }, update: {} });

    const departments = new Map();
    for (const name of [...new Set([...(settings.departments || []), ...employees.map((row) => row.fields?.Department)].filter(Boolean).map((v) => String(v).trim()))]) {
      let department = await tx.department.findUnique({ where: { name } });
      if (!department) {
        const base = enumValue(name).replace(/[^A-Z0-9]/g, '').slice(0, 12) || 'DEPT';
        let code = base; let suffix = 1;
        while (await tx.department.findUnique({ where: { code } })) code = `${base.slice(0, 9)}${suffix++}`;
        department = await tx.department.create({ data: { name, code } });
        add('Department', name, 'CREATED', undefined, department.id, name);
      } else add('Department', name, 'SKIPPED', 'Target already exists', department.id, name);
      departments.set(name, department.id);
    }

    const leaveTypes = new Map();
    for (const row of settings.leaveTypes || []) {
      let leaveType = await tx.leaveType.findFirst({ where: { OR: [{ id: row.id }, { name: row.name }], deletedAt: null } });
      if (!leaveType) {
        const base = enumValue(row.name).replace(/[^A-Z0-9]/g, '').slice(0, 40) || 'LEAVE';
        let code = base; let suffix = 1;
        while (await tx.leaveType.findUnique({ where: { code } })) code = `${base.slice(0, 36)}${suffix++}`;
        leaveType = await tx.leaveType.create({ data: { id: isUuid(row.id) ? row.id : randomUUID(), name: row.name, code, annualAllowanceDays: decimal(row.days), isPaid: !String(row.name).toLowerCase().includes('unpaid') } });
        add('LeaveType', row.id, 'CREATED', undefined, leaveType.id, row);
      } else add('LeaveType', row.id, 'SKIPPED', 'Target already exists', leaveType.id, row);
      leaveTypes.set(String(row.name).toLowerCase(), leaveType.id);
    }

    const importedEmployees = new Set();
    for (const row of employees) {
      const data = employeeData(row, departments);
      const conflict = await tx.employee.findFirst({ where: { OR: [{ employeeCode: data.employeeCode }, { email: data.email }], NOT: { id: data.id } } });
      if (conflict) { add('Employee', row.id, 'CONFLICT', 'Employee code or email belongs to another record', conflict.id, row); continue; }
      const existing = await tx.employee.findUnique({ where: { id: row.id } });
      if (!existing) {
        await tx.employee.create({ data }); importedEmployees.add(row.id); add('Employee', row.id, 'CREATED', undefined, row.id, row);
      } else add('Employee', row.id, 'SKIPPED', 'Target already exists', row.id, row);
      const f = row.fields || {};
      await tx.employeeProfile.upsert({ where: { employeeId: row.id }, create: { employeeId: row.id, ...profileData(row) }, update: {} });
      await tx.employeeBankAccount.upsert({ where: { employeeId: row.id }, create: { employeeId: row.id, bankCode: present(f['Bank Code']), iban: present(f['IBAN No.']), accountNumber: present(f['Account No.']) }, update: {} });
      await tx.employeeBenefitProfile.upsert({ where: { employeeId: row.id }, create: {
        employeeId: row.id, travelSector: present(f['Travel Sector']), travelCost: decimal(f['Travel Cost']), employeeTicketsPerYear: number(f['No. of Tickets - Employee (Year)']),
        ticketBalancePercent: decimal(f['Ticket Balance (%)']), familyTickets: number(f['No. of Tickets - Family']), companyAccommodation: enumValue(f['Company Accommodation']) === 'YES',
        companyTransportation: enumValue(f['Company Transportation']) === 'YES', overtimeEligible: enumValue(f['Overtime Eligible']) === 'YES',
        companyFood: enumValue(f['Company Food']) === 'YES', companyFuelCard: enumValue(f['Company Fuel Card']) === 'YES',
      }, update: {} });
      const allowances = decimal(f.HRA).plus(decimal(f['Food Allowance'])).plus(decimal(f['Mobile Allowance'])).plus(decimal(f['Special Allowance']));
      if (!await tx.salaryRecord.findFirst({ where: { employeeId: row.id, deletedAt: null } })) await tx.salaryRecord.create({ data: { employeeId: row.id, baseSalary: decimal(f.Basic), allowances, bonuses: decimal(f['Overtime Amount']), effectiveFrom: data.hireDate } });
      if (present(f['Highest Education Qualification']) && !await tx.employeeEducation.findFirst({ where: { employeeId: row.id, qualification: f['Highest Education Qualification'], deletedAt: null } })) await tx.employeeEducation.create({ data: { employeeId: row.id, qualification: f['Highest Education Qualification'], yearOfPassing: present(f['Year of Passing']) ? number(f['Year of Passing']) : undefined } });
      for (const credential of [
        ['QID', f['RP/ID Number'], f['RP/ID Profession'], undefined, undefined, f['QID Expiry Date']],
        ['WORK_PERMIT', f['Work Permit No.'], undefined, undefined, f['Work Permit Issue Date'], f['Work Permit Expiry Date']],
        ['PASSPORT', f['Passport No.'], undefined, f['Passport Place of Issue'], f['Passport Issue Date'], f['Passport Expiry Date']],
        ['DRIVING_LICENSE', f['Driving License No.'], f['License Type'], undefined, undefined, f['Driving License Expiry Date']],
        ['INSURANCE', f['Insurance Card No.'], undefined, undefined, f['Insurance Issue Date'], f['Insurance Expiry Date']],
      ]) if (present(credential[1])) await tx.employeeCredential.upsert({ where: { employeeId_type: { employeeId: row.id, type: credential[0] } }, create: { employeeId: row.id, type: credential[0], number: credential[1], profession: present(credential[2]), placeOfIssue: present(credential[3]), issueDate: date(credential[4]), expiryDate: date(credential[5]) }, update: {} });
    }

    for (const row of employees) {
      const managerValue = String(row.fields?.['Reporting Manager Employee Code/Name'] || '').trim();
      if (!managerValue) continue;
      const manager = await tx.employee.findFirst({ where: { OR: [{ employeeCode: managerValue }, { firstName: { contains: managerValue, mode: 'insensitive' } }], deletedAt: null } });
      if (manager && manager.id !== row.id) await tx.employee.update({ where: { id: row.id }, data: { managerId: manager.id } });
    }

    for (const [dateKey, rows] of Object.entries(state.attendance || {})) for (const [employeeId, code] of Object.entries(rows || {})) {
      if (!await tx.employee.findUnique({ where: { id: employeeId } })) { add('Attendance', `${employeeId}:${dateKey}`, 'INVALID', 'Employee not found', undefined, { dateKey, employeeId, code }); continue; }
      const attendanceDate = date(dateKey); const status = { P: 'PRESENT', H: 'HALF_DAY', L: 'ON_LEAVE', A: 'ABSENT' }[code];
      const approval = state.attendanceApprovals?.[dateKey]?.[employeeId] === 'Approved' ? 'APPROVED' : 'NOT_APPROVED';
      const key = { employeeId_attendanceDate: { employeeId, attendanceDate } };
      if (await tx.attendance.findUnique({ where: key })) add('Attendance', `${employeeId}:${dateKey}`, 'SKIPPED', 'Target already exists', undefined, { dateKey, employeeId, code });
      else { const row = await tx.attendance.create({ data: { employeeId, attendanceDate, status, approvalStatus: approval, workingHours: code === 'H' ? decimal(settings.halfDayHours || 4) : code === 'P' ? decimal(settings.workdayHours || 8) : decimal(0) } }); add('Attendance', `${employeeId}:${dateKey}`, 'CREATED', undefined, row.id, { dateKey, employeeId, code }); }
    }

    for (const row of state.leaves || []) {
      const leaveTypeId = leaveTypes.get(String(row.type).toLowerCase());
      if (!leaveTypeId || !await tx.employee.findUnique({ where: { id: row.employeeId } })) { add('LeaveRequest', row.id, 'INVALID', 'Employee or leave type not found', undefined, row); continue; }
      await created('LeaveRequest', row.id, row, () => tx.leaveRequest.findUnique({ where: { id: row.id } }), () => tx.leaveRequest.create({ data: { id: row.id, employeeId: row.employeeId, leaveTypeId, startDate: date(row.from), endDate: date(row.to), totalDays: decimal(row.days), isHalfDay: number(row.days) === 0.5, reason: row.reason || 'Legacy leave', status: enumValue(row.status), approvedAt: date(row.decidedOn), createdAt: date(row.appliedOn) || source.createdAt } }));
    }

    const balanceYears = new Set([new Date().getUTCFullYear(), ...(state.leaves || []).map((row) => date(row.from)?.getUTCFullYear()).filter(Boolean)]);
    const [balanceEmployees, paidLeaveTypes] = await Promise.all([
      tx.employee.findMany({ where: { deletedAt: null }, select: { id: true } }),
      tx.leaveType.findMany({ where: { deletedAt: null, isPaid: true }, select: { id: true, annualAllowanceDays: true } }),
    ]);
    for (const employee of balanceEmployees) for (const leaveType of paidLeaveTypes) for (const year of balanceYears) {
      const existing = await tx.leaveBalance.findUnique({ where: { employeeId_leaveTypeId_year: { employeeId: employee.id, leaveTypeId: leaveType.id, year } } });
      const balanceKey = `${employee.id}:${leaveType.id}:${year}`;
      if (existing) { add('LeaveBalance', balanceKey, 'SKIPPED', 'Target already exists', existing.id, { employeeId: employee.id, leaveTypeId: leaveType.id, year }); continue; }
      const yearStart = new Date(Date.UTC(year, 0, 1)); const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
      const [approved, pending] = await Promise.all([
        tx.leaveRequest.aggregate({ where: { employeeId: employee.id, leaveTypeId: leaveType.id, status: 'APPROVED', startDate: { gte: yearStart, lte: yearEnd }, deletedAt: null }, _sum: { totalDays: true } }),
        tx.leaveRequest.aggregate({ where: { employeeId: employee.id, leaveTypeId: leaveType.id, status: 'PENDING', startDate: { gte: yearStart, lte: yearEnd }, deletedAt: null }, _sum: { totalDays: true } }),
      ]);
      const usedDays = approved._sum.totalDays || new Prisma.Decimal(0);
      const pendingDays = pending._sum.totalDays || new Prisma.Decimal(0);
      const totalDays = Prisma.Decimal.max(leaveType.annualAllowanceDays, new Prisma.Decimal(usedDays).plus(pendingDays));
      const createdBalance = await tx.leaveBalance.create({ data: { employeeId: employee.id, leaveTypeId: leaveType.id, year, totalDays, usedDays, pendingDays } });
      add('LeaveBalance', balanceKey, 'CREATED', undefined, createdBalance.id, { employeeId: employee.id, leaveTypeId: leaveType.id, year });
    }

    for (const row of state.payroll || []) {
      if (!await tx.employee.findUnique({ where: { id: row.employeeId } })) { add('Payroll', row.id, 'INVALID', 'Employee not found', undefined, row); continue; }
      const existing = await tx.payroll.findUnique({ where: { employeeId_year_month: { employeeId: row.employeeId, year: row.year, month: row.month } } });
      if (existing) { add('Payroll', row.id, 'SKIPPED', 'Payroll period already exists', existing.id, row); continue; }
      const payroll = await tx.payroll.create({ data: { id: row.id, employeeId: row.employeeId, year: row.year, month: row.month, baseSalary: decimal(row.basic), allowances: decimal(row.housing).plus(decimal(row.allowances)), deductions: decimal(row.deductions).plus(decimal(row.lopAmount)).plus(decimal(row.loanDeduction)), bonuses: decimal(row.overtime).plus(decimal(row.bonus)), grossPay: decimal(row.gross), netPay: decimal(row.net), status: row.status === 'Finalized' ? 'APPROVED' : 'DRAFT' } });
      const lines = [['BASE_SALARY', 'Base salary', row.basic], ['ALLOWANCE', 'Housing and allowances', decimal(row.housing).plus(decimal(row.allowances))], ['BONUS', 'Overtime and bonus', decimal(row.overtime).plus(decimal(row.bonus))], ['FIXED_DEDUCTION', 'Deductions', row.deductions], ['LOSS_OF_PAY', 'Loss of pay', row.lopAmount]];
      await tx.payrollLineItem.createMany({ data: lines.filter((line) => decimal(line[2]).gt(0)).map((line) => ({ payrollId: payroll.id, kind: line[0], description: line[1], amount: decimal(line[2]) })) });
      add('Payroll', row.id, 'CREATED', undefined, payroll.id, row);
    }

    for (const row of state.businessTrips || []) await created('BusinessTrip', row.id, row, () => tx.businessTrip.findUnique({ where: { id: row.id } }), () => tx.businessTrip.create({ data: { id: row.id, employeeId: row.employeeId, destination: row.destination, purpose: row.purpose, startDate: date(row.from), endDate: date(row.to), days: decimal(row.days), perDiem: decimal(row.perDiem), travelCost: decimal(row.travelCost), advanceAmount: decimal(row.advanceAmount), status: enumValue(row.status), createdAt: date(row.createdOn) || source.createdAt } }));
    for (const row of state.expenses || []) await created('EmployeeExpense', row.id, row, () => tx.employeeExpense.findUnique({ where: { id: row.id } }), () => tx.employeeExpense.create({ data: { id: row.id, employeeId: row.employeeId, tripId: present(row.tripId), category: row.category, expenseDate: date(row.date), amount: decimal(row.amount), description: row.description, status: enumValue(row.status), createdAt: date(row.createdOn) || source.createdAt } }));
    for (const row of state.loans || []) {
      const [startYear, startMonth] = String(row.startPeriod || '').split('-').map(Number);
      await created('EmployeeLoan', row.id, row, () => tx.employeeLoan.findUnique({ where: { id: row.id } }), async () => {
        await tx.employeeLoan.create({ data: { id: row.id, employeeId: row.employeeId, type: row.type, principal: decimal(row.principal), disbursementDate: date(row.disbursementDate), startYear, startMonth, repaymentMode: enumValue(row.repaymentMode) === 'DURATION' ? 'DURATION' : enumValue(row.repaymentMode) === 'MONTHLY_LIMIT' ? 'MONTHLY_LIMIT' : 'MANUAL', termMonths: row.termMonths || 1, monthlyLimit: decimal(row.monthlyLimit), status: enumValue(row.status), reference: present(row.reference), notes: present(row.notes), createdAt: date(row.createdOn) || source.createdAt } });
        for (const [period, override] of Object.entries(row.deductionOverrides || {})) { const [year, month] = period.split('-').map(Number); await tx.loanDeductionOverride.create({ data: { loanId: row.id, year, month, amount: decimal(override.amount), reason: override.reason, approvedAboveLimit: Boolean(override.approvedAboveLimit) } }); }
      });
    }
    for (const row of state.loanRepayments || []) await created('LoanRepayment', row.id, row, () => tx.loanRepayment.findUnique({ where: { id: row.id } }), () => tx.loanRepayment.create({ data: { id: row.id, loanId: row.loanId, payrollId: present(row.payrollId), year: row.year, month: row.month, amount: decimal(row.amount), source: enumValue(row.source), status: enumValue(row.status), note: present(row.note), postedAt: date(row.postedOn) || source.createdAt, reversedAt: row.status === 'Reversed' ? date(row.postedOn) : undefined } }));

    for (const row of state.jobs || []) {
      const departmentId = departments.get(String(row.dept || '').trim());
      await created('RecruitmentJob', row.id, row, () => tx.recruitmentJob.findUnique({ where: { id: row.id } }), () => tx.recruitmentJob.create({ data: { id: row.id, title: row.title, departmentId, openings: row.openings || 1, status: enumValue(row.status), postedOn: date(row.postedOn), description: present(row.description) } }));
    }
    for (const row of state.candidates || []) await created('RecruitmentCandidate', row.id, row, () => tx.recruitmentCandidate.findUnique({ where: { id: row.id } }), () => tx.recruitmentCandidate.create({ data: { id: row.id, jobId: row.jobId, employeeId: present(row.employeeId), name: row.name, email: String(row.email).toLowerCase(), phone: present(row.phone), stage: enumValue(row.stage), rating: decimal(row.rating), notes: present(row.notes), appliedOn: date(row.appliedOn) } }));
    for (const row of state.eosRecords || []) await created('EosRecord', row.id, row, () => tx.eosRecord.findUnique({ where: { id: row.id } }), () => tx.eosRecord.create({ data: { id: row.id, employeeId: row.employeeId, asOf: date(row.asOf), reason: row.reason, serviceYears: new Prisma.Decimal(row.serviceYears || 0), gratuity: decimal(row.gratuity), leaveEncashment: decimal(row.leaveEncashment), lopDeduction: decimal(row.lopDeduction), expenseReimbursement: decimal(row.expenseReimbursement), tripAdvanceDeduction: decimal(row.tripAdvanceDeduction), netSettlement: decimal(row.netSettlement), status: enumValue(row.status), createdAt: date(row.createdOn) || source.createdAt } }));
    for (const row of state.documents || []) {
      if (row.dataUrl) continue;
      const uploader = await tx.employee.findUnique({ where: { id: row.employeeId } });
      if (!uploader) { add('EmployeeDocument', row.id, 'INVALID', 'Employee not found', undefined, row); continue; }
      await created('EmployeeDocument', row.id, row, () => tx.employeeDocument.findUnique({ where: { id: row.id } }), () => tx.employeeDocument.create({ data: { id: row.id, employeeId: row.employeeId, uploadedById: row.employeeId, documentType: row.template, fileName: row.filename || `${row.documentNumber}.pdf`, documentNumber: row.documentNumber, sizeBytes: row.sizeBytes, visibility: 'HR_ONLY', createdAt: date(row.generatedOn) || source.createdAt } }));
    }

    const blockingItems = report.filter((item) => item.status === 'INVALID' || item.status === 'CONFLICT');
    if (blockingItems.length) throw new Error(`Import stopped because ${blockingItems.length} record(s) require correction: ${JSON.stringify(blockingItems)}`);
    const counts = report.reduce((out, item) => ({ ...out, [item.status]: (out[item.status] || 0) + 1 }), {});
    await tx.importItem.createMany({ data: report.map((item) => ({ runId: run.id, ...item })) });
    await tx.importRun.update({ where: { id: run.id }, data: { createdCount: counts.CREATED || 0, skippedCount: counts.SKIPPED || 0, invalidCount: counts.INVALID || 0, conflictCount: counts.CONFLICT || 0, completedAt: new Date() } });
    await tx.auditEvent.create({ data: { action: 'IMPORT', entityType: 'HrConsoleState', entityId: source.id, summary: 'Legacy workspace imported into normalized HR records' } });
    return tx.importRun.findUnique({ where: { id: run.id }, include: { items: true } });
  }, { isolationLevel: 'Serializable', timeout: 120000 });
  console.log(JSON.stringify({ mode: 'apply', sourceHash, run: result }, null, 2));
}

run().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
