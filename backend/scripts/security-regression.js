const assert = require('node:assert/strict');
const {
  AttendanceStatus,
  DocumentVisibility,
  LeaveRequestStatus,
  PayrollStatus,
  ReviewStatus,
  Role,
} = require('@prisma/client');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { listArgs } = require('../dist/common/utils/crud.util');
const { AnnouncementsService } = require('../dist/modules/announcements/announcements.service');
const { AttendanceService } = require('../dist/modules/attendance/attendance.service');
const { AuthService } = require('../dist/modules/auth/auth.service');
const { JwtStrategy } = require('../dist/modules/auth/strategies/jwt.strategy');
const { ConsoleStateService } = require('../dist/modules/console-state/console-state.service');
const { DocumentsService } = require('../dist/modules/documents/documents.service');
const { EmployeesService } = require('../dist/modules/employees/employees.service');
const { LeaveService } = require('../dist/modules/leave/leave.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { PerformanceReviewsService } = require('../dist/modules/performance-reviews/performance-reviews.service');
const { createInitialLoginUsers } = require('../prisma/seed');

async function expectRejected(action, message) {
  await assert.rejects(action, (error) => error?.message === message);
}

async function main() {
  const activeOnly = listArgs({ page: 1, limit: 20, includeDeleted: true }, {});
  assert.deepEqual(activeOnly.where.AND[0], { deletedAt: null });

  let bootstrapCreates = 0;
  const existingBootstrapPrisma = {
    $transaction: async (callback) => callback({
      user: {
        findMany: async () => [{ email: 'hr@med-tech.com' }],
        create: async () => { bootstrapCreates += 1; },
      },
    }),
  };
  await assert.rejects(
    () => createInitialLoginUsers(existingBootstrapPrisma, [{
      email: 'hr@med-tech.com', passwordHash: 'hash', role: Role.SUPER_ADMIN,
    }], []),
    /Login bootstrap refused/,
  );
  assert.equal(bootstrapCreates, 0);
  const emptyBootstrapPrisma = {
    $transaction: async (callback) => callback({
      user: {
        findMany: async () => [],
        create: async () => { bootstrapCreates += 1; },
      },
    }),
  };
  await createInitialLoginUsers(emptyBootstrapPrisma, [
    { email: 'hr@med-tech.com', passwordHash: 'hash-1', role: Role.SUPER_ADMIN },
    { email: 'admin@med-tech.com', passwordHash: 'hash-2', role: Role.HR_ADMIN },
  ], []);
  assert.equal(bootstrapCreates, 2);

  const request = {
    id: 'request',
    employeeId: 'self',
    leaveTypeId: 'annual',
    startDate: new Date('2026-07-10T00:00:00Z'),
    endDate: new Date('2026-07-11T00:00:00Z'),
    totalDays: 2,
    isHalfDay: false,
    status: LeaveRequestStatus.PENDING,
  };
  const balance = { id: 'balance', totalDays: 20, usedDays: 0, pendingDays: 2 };
  let leaveWrite;
  let overlappingLeave = false;
  const leavePrisma = {
    employee: { findFirst: async () => ({ id: 'self', managerId: null }) },
    leaveType: { findFirst: async () => ({ id: 'annual' }) },
    leaveRequest: { findFirst: async ({ where } = {}) => where?.id === 'request' || overlappingLeave ? request : null },
    leaveBalance: { findFirst: async () => balance },
    $transaction: async (callback) => callback({
      employee: leavePrisma.employee,
      leaveType: leavePrisma.leaveType,
      leaveBalance: {
        findFirst: async () => balance,
        update: async () => undefined,
      },
      leaveRequest: {
        findFirst: async ({ where } = {}) => where?.id === 'request' || overlappingLeave ? request : null,
        update: async (args) => (leaveWrite = args.data),
        create: async (args) => (leaveWrite = args.data),
      },
    }),
  };
  const leave = new LeaveService(leavePrisma);
  const employee = { role: Role.EMPLOYEE, employeeId: 'self' };
  await leave.updateRequest('request', { employeeId: 'victim', reason: 'updated' }, employee);
  assert.equal('employeeId' in leaveWrite, false);

  balance.pendingDays = 0;
  await leave.createRequest({
    employeeId: 'victim',
    leaveTypeId: 'annual',
    startDate: new Date('2026-07-20T18:00:00Z'),
    endDate: new Date('2026-07-22T18:00:00Z'),
    totalDays: 99,
    reason: 'server-calculated',
  }, { role: Role.HR_ADMIN, employeeId: 'hr' });
  assert.equal(leaveWrite.totalDays, 3);
  assert.equal(leaveWrite.employeeId, 'victim');
  overlappingLeave = true;
  await expectRejected(
    () => leave.createRequest({
      employeeId: 'victim',
      leaveTypeId: 'annual',
      startDate: new Date('2026-07-21T00:00:00Z'),
      endDate: new Date('2026-07-21T00:00:00Z'),
    }, { role: Role.HR_ADMIN, employeeId: 'hr' }),
    'Leave dates overlap an existing pending or approved request',
  );
  overlappingLeave = false;
  await expectRejected(
    () => leave.createRequest({
      leaveTypeId: 'annual',
      startDate: new Date('2026-07-20T00:00:00Z'),
      endDate: new Date('2026-07-21T00:00:00Z'),
      isHalfDay: true,
    }, employee),
    'Half-day leave must start and end on the same date',
  );
  await expectRejected(
    () => leave.removeRequest('request'),
    'Cancel pending or approved leave before deleting it',
  );

  const employeeLookup = async ({ where }) => {
    if (where.managerId) return where.id === 'direct-report' ? { id: where.id } : null;
    return { id: where.id };
  };
  const reviews = new PerformanceReviewsService({
    employee: { findFirst: employeeLookup },
    performanceReview: {
      findFirst: async () => ({
        id: 'review',
        employeeId: 'direct-report',
        reviewerId: 'other-manager',
        status: ReviewStatus.SUBMITTED,
        reviewPeriodStart: new Date('2026-01-01T00:00:00Z'),
        reviewPeriodEnd: new Date('2026-06-30T00:00:00Z'),
      }),
    },
  });
  const manager = { role: Role.MANAGER, employeeId: 'manager' };
  await expectRejected(
    () => reviews.create({
      employeeId: 'direct-report',
      reviewerId: 'victim',
      reviewPeriodStart: new Date('2026-01-01T00:00:00Z'),
      reviewPeriodEnd: new Date('2026-06-30T00:00:00Z'),
      rating: 4,
    }, manager),
    'Managers cannot submit reviews as another employee',
  );
  await expectRejected(
    () => reviews.update('review', { comments: 'overwrite' }, manager),
    'Managers can only update reviews they created',
  );

  let consoleState = { id: 'default', data: { marker: 'original' }, updatedAt: new Date('2026-07-12T00:00:00Z') };
  const backups = [];
  const backupPrisma = {
    hrConsoleState: {
      findUnique: async () => consoleState,
      update: async ({ data }) => (consoleState = { ...consoleState, ...data, updatedAt: new Date() }),
      updateMany: async ({ data }) => {
        consoleState = { ...consoleState, ...data, updatedAt: new Date() };
        return { count: 1 };
      },
    },
    hrConsoleStateBackup: {
      count: async () => backups.length,
      findFirst: async () => backups.at(-1) || null,
      create: async ({ data }) => {
        const backup = { id: `backup-${backups.length + 1}`, createdAt: new Date(), ...data };
        backups.push(backup);
        return backup;
      },
      findMany: async ({ skip }) => backups.slice().reverse().slice(skip).map(({ id }) => ({ id })),
      deleteMany: async ({ where }) => {
        for (const id of where.id.in) backups.splice(backups.findIndex((item) => item.id === id), 1);
      },
    },
    $transaction: async (actions) => typeof actions === 'function' ? actions(backupPrisma) : Promise.all(actions),
  };
  const consoleStateService = new ConsoleStateService(backupPrisma);
  await expectRejected(
    () => consoleStateService.save({ data: {} }, { id: 'hr-user' }),
    'Workspace data is missing a required record collection',
  );
  await consoleStateService.createBackup('MANUAL', 'hr-user');
  consoleState = { ...consoleState, data: { marker: 'changed' }, updatedAt: new Date('2026-07-12T01:00:00Z') };
  await consoleStateService.rollbackLatest('hr-user');
  assert.deepEqual(consoleState.data, { marker: 'original' });
  assert.equal(backups.at(-1).kind, 'ROLLBACK_SAFETY');

  const scheduledBackups = [];
  const schedulePrisma = {
    hrConsoleState: { findUnique: async () => ({ data: { marker: 'scheduled' }, updatedAt: new Date() }) },
    hrConsoleStateBackup: {
      findFirst: async () => scheduledBackups.at(-1) ?? null,
      create: async ({ data }) => {
        scheduledBackups.push({ ...data, createdAt: new Date() });
      },
      findMany: async () => [],
      deleteMany: async () => undefined,
    },
    $transaction: async (callback) => callback(schedulePrisma),
  };
  const scheduledBackupService = new ConsoleStateService(schedulePrisma);
  await scheduledBackupService.ensureScheduledBackup();
  await scheduledBackupService.ensureScheduledBackup();
  assert.equal(scheduledBackups.length, 1);

  const documents = new DocumentsService({
    employee: { findFirst: async () => ({ id: 'employee' }) },
    employeeDocument: {
      findFirst: async () => ({ id: 'document', employeeId: 'self', uploadedById: 'self' }),
    },
  });
  await expectRejected(
    () => documents.create({
      employeeId: 'self',
      documentType: 'ID',
      fileName: 'id.pdf',
      fileUrl: 'https://example.invalid/id.pdf',
      uploadedById: 'victim',
    }, employee),
    'Employees cannot upload documents as another employee',
  );
  await expectRejected(
    () => documents.update('document', { visibility: DocumentVisibility.PUBLIC }, employee),
    'Only HR can publish documents to all employees',
  );

  const announcements = new AnnouncementsService({
    employee: { findFirst: async () => ({ departmentId: 'manager-department' }) },
    announcement: { findFirst: async () => ({ id: 'announcement', createdById: 'hr-owner' }) },
  });
  await expectRejected(
    () => announcements.update('announcement', { title: 'overwrite' }, manager),
    'Managers can only update announcements they created',
  );
  await expectRejected(
    () => announcements.create({ title: 'Foreign', content: 'No', departmentId: 'other-department' }, manager),
    'Managers can only publish announcements to their own department',
  );
  await expectRejected(
    () => announcements.create({ title: 'Privileged', content: 'No', audienceRoles: [Role.HR_ADMIN] }, manager),
    'Managers can only target employees and managers',
  );

  const payroll = new PayrollService({
    employee: {
      findFirst: async () => ({ id: 'employee-1' }),
      findMany: async () => [{ id: 'employee-1', salary: 3_000 }],
    },
    payroll: {
      create: async ({ data }) => data,
    },
    $transaction: async (callback) => callback({
      payroll: {
        findUnique: async () => ({
          id: 'payroll',
          employeeId: 'employee-1',
          status: PayrollStatus.APPROVED,
          deletedAt: null,
        }),
      },
    }),
  });
  const manualPayroll = await payroll.create({
    employeeId: 'employee-1', year: 2026, month: 7, baseSalary: 3_000,
    allowances: 200, deductions: 100, bonuses: 50, taxAmount: 25,
    grossPay: 1, netPay: 1, status: PayrollStatus.PAID,
  });
  assert.equal(manualPayroll.grossPay, 3_250);
  assert.equal(manualPayroll.netPay, 3_125);
  assert.equal(manualPayroll.status, PayrollStatus.DRAFT);
  const generation = await payroll.generate({ year: 2026, month: 7 });
  assert.equal(generation.meta.generatedCount, 0);
  assert.equal(generation.meta.skippedFinalizedCount, 1);

  let attendanceWrite;
  const attendancePrisma = {
    employee: { findFirst: async () => ({ id: 'employee-1' }) },
    $transaction: async (callback) => callback({
      payroll: { findFirst: async () => null },
      attendance: {
        findUnique: async () => ({ id: 'attendance', deletedAt: new Date() }),
        update: async ({ data }) => (attendanceWrite = data),
      },
    }),
  };
  const attendance = new AttendanceService(attendancePrisma);
  await attendance.create({
    employeeId: 'employee-1',
    attendanceDate: new Date('2026-07-14T00:00:00Z'),
    checkIn: new Date('2026-07-14T06:30:00Z'),
    checkOut: new Date('2026-07-14T14:30:00Z'),
    status: AttendanceStatus.PRESENT,
    isLate: false,
    lateMinutes: 0,
    workingHours: 99,
  });
  assert.equal(attendanceWrite.deletedAt, null);
  assert.equal(attendanceWrite.isLate, true);
  assert.equal(attendanceWrite.lateMinutes, 30);
  assert.equal(attendanceWrite.workingHours, 8);
  assert.equal(attendance.companyDay(new Date('2026-07-13T21:30:00Z')).toISOString(), '2026-07-14T00:00:00.000Z');

  const attendanceReport = new AttendanceService({
    attendance: {
      findMany: async ({ skip, take }) => {
        assert.equal(skip, 20);
        assert.equal(take, 20);
        return [{ id: 'paged-record' }];
      },
      aggregate: async () => ({ _count: { _all: 250 }, _sum: { workingHours: 1_999.5 } }),
      count: async () => 12,
      groupBy: async () => [
        { status: AttendanceStatus.PRESENT, _count: { _all: 220 } },
        { status: AttendanceStatus.ABSENT, _count: { _all: 30 } },
      ],
    },
  });
  const report = await attendanceReport.report({ page: 2, limit: 20 }, { role: Role.HR_ADMIN });
  assert.equal(report.data.records.length, 1);
  assert.equal(report.data.summary.totalRecords, 250);
  assert.equal(report.data.summary.lateRecords, 12);
  assert.equal(report.data.summary.byStatus.PRESENT, 220);
  assert.deepEqual(report.meta, { total: 250, page: 2, limit: 20, totalPages: 13 });

  let deactivatedUser;
  const employees = new EmployeesService({
    $transaction: async (callback) => callback({
      employee: {
        findFirst: async ({ where }) => where.managerId ? null : ({ id: 'employee', userId: 'user' }),
        update: async ({ data }) => data,
      },
      department: { findFirst: async () => null },
      user: { update: async ({ data }) => (deactivatedUser = data) },
    }),
  });
  await employees.remove('employee');
  assert.equal(deactivatedUser.isActive, false);
  assert.deepEqual(deactivatedUser.sessionVersion, { increment: 1 });

  let responseBody;
  const filter = new HttpExceptionFilter();
  filter.catch(new Error('INTERNAL_DETAIL_MARKER'), {
    switchToHttp: () => ({
      getResponse: () => ({ status: () => ({ json: (body) => { responseBody = body; } }) }),
      getRequest: () => ({ url: '/api/v1/test' }),
    }),
  });
  assert.equal(responseBody.message, 'Internal server error');

  const throttles = new Map();
  const throttlePrisma = {
    authThrottle: {
      findUnique: async ({ where }) => throttles.get(where.key) ?? null,
      deleteMany: async ({ where }) => {
        if (where.key?.in) for (const key of where.key.in) throttles.delete(key);
        if (where.key && typeof where.key === 'string') throttles.delete(where.key);
        if (where.resetAt?.lte) {
          for (const [key, value] of throttles) if (value.resetAt <= where.resetAt.lte) throttles.delete(key);
        }
      },
    },
    $executeRaw: async (_strings, key, resetAt, now) => {
      const current = throttles.get(key);
      throttles.set(key, current && current.resetAt > now
        ? { ...current, count: current.count + 1 }
        : { key, count: 1, resetAt });
      return 1;
    },
  };
  const config = { get: (_key, fallback) => fallback, getOrThrow: () => 'x'.repeat(64) };
  const auth = new AuthService({}, { sign: () => 'token' }, config, throttlePrisma);
  for (let index = 0; index < 20; index += 1) {
    await auth.recordFailedLogin(`ip-${index}`, 'account@example.invalid');
  }
  const restartedAuth = new AuthService({}, { sign: () => 'token' }, config, throttlePrisma);
  await assert.rejects(
    () => restartedAuth.checkLoginLimit('new-ip', 'account@example.invalid'),
    /Too many login attempts/,
  );

  const strategy = new JwtStrategy(
    { getOrThrow: () => 'x'.repeat(64) },
    { findById: async () => ({
      id: 'user', isActive: true, deletedAt: null, sessionVersion: 2,
      employee: { id: 'employee', deletedAt: new Date() },
    }) },
  );
  await expectRejected(
    () => strategy.validate({ sub: 'user', csrfToken: 'csrf', sessionVersion: 2 }),
    'User account is inactive',
  );

  console.log('Security regression checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
