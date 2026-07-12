const assert = require('node:assert/strict');
const { DocumentVisibility, LeaveRequestStatus, Role } = require('@prisma/client');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { AnnouncementsService } = require('../dist/modules/announcements/announcements.service');
const { AuthService } = require('../dist/modules/auth/auth.service');
const { JwtStrategy } = require('../dist/modules/auth/strategies/jwt.strategy');
const { DocumentsService } = require('../dist/modules/documents/documents.service');
const { LeaveService } = require('../dist/modules/leave/leave.service');
const { PerformanceReviewsService } = require('../dist/modules/performance-reviews/performance-reviews.service');
const { ConsoleStateService } = require('../dist/modules/console-state/console-state.service');

async function expectRejected(action, message) {
  await assert.rejects(action, (error) => error?.message === message);
}

async function main() {
  let leaveWrite;
  const request = {
    id: 'request',
    employeeId: 'self',
    leaveTypeId: 'annual',
    startDate: new Date('2026-07-10'),
    endDate: new Date('2026-07-11'),
    totalDays: 2,
    status: LeaveRequestStatus.PENDING,
  };
  const balance = { id: 'balance', totalDays: 20, usedDays: 0, pendingDays: 2 };
  const leave = new LeaveService({
    leaveRequest: { findFirst: async () => request },
    leaveBalance: { findFirst: async () => balance },
    $transaction: async (callback) => callback({
      leaveBalance: { update: async () => undefined },
      leaveRequest: { update: async (args) => (leaveWrite = args.data) },
    }),
  });
  await leave.updateRequest(
    'request',
    { employeeId: 'victim', reason: 'updated' },
    { role: Role.EMPLOYEE, employeeId: 'self' },
  );
  assert.equal('employeeId' in leaveWrite, false);

  const employeeLookup = async ({ where }) => {
    if (where.managerId) return where.id === 'direct-report' ? { id: where.id } : null;
    return { id: where.id };
  };
  const reviews = new PerformanceReviewsService({
    employee: { findFirst: employeeLookup },
    performanceReview: { findFirst: async () => ({ id: 'review', employeeId: 'direct-report' }) },
  });
  const manager = { role: Role.MANAGER, employeeId: 'manager' };
  await expectRejected(
    () => reviews.create({ employeeId: 'direct-report', reviewerId: 'victim' }, manager),
    'Managers cannot submit reviews as another employee',
  );

  let consoleState = { id: 'default', data: { marker: 'original' }, updatedAt: new Date('2026-07-12T00:00:00Z') };
  const backups = [];
  const backupPrisma = {
    hrConsoleState: {
      findUnique: async () => consoleState,
      update: async ({ data }) => (consoleState = { ...consoleState, ...data, updatedAt: new Date() }),
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
        for (const id of where.id.in) backups.splice(backups.findIndex(item => item.id === id), 1);
      },
    },
    $transaction: async (actions) => Promise.all(actions),
  };
  const consoleStateService = new ConsoleStateService(backupPrisma);
  await consoleStateService.createBackup('MANUAL', 'hr-user');
  consoleState = { ...consoleState, data: { marker: 'changed' }, updatedAt: new Date('2026-07-12T01:00:00Z') };
  await consoleStateService.rollbackLatest('hr-user');
  assert.deepEqual(consoleState.data, { marker: 'original' });
  assert.equal(backups.at(-1).kind, 'ROLLBACK_SAFETY');
  await expectRejected(
    () => reviews.update('review', { employeeId: 'victim' }, manager),
    'Managers can only review direct reports',
  );

  const documents = new DocumentsService({
    employee: { findFirst: async () => ({ id: 'employee' }) },
    employeeDocument: {
      findFirst: async () => ({ id: 'document', employeeId: 'self', uploadedById: 'self' }),
    },
  });
  const employee = { role: Role.EMPLOYEE, employeeId: 'self' };
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
    announcement: { findFirst: async () => ({ id: 'announcement', createdById: 'hr-owner' }) },
  });
  await expectRejected(
    () => announcements.update('announcement', { title: 'overwrite' }, manager),
    'Managers can only update announcements they created',
  );

  let responseBody;
  const filter = new HttpExceptionFilter();
  filter.catch(new Error('INTERNAL_DETAIL_MARKER'), {
    switchToHttp: () => ({
      getResponse: () => ({ status: () => ({ json: (body) => { responseBody = body; } }) }),
      getRequest: () => ({ url: '/api/v1/test' }),
    }),
  });
  assert.equal(responseBody.message, 'Internal server error');

  const auth = new AuthService({}, { sign: () => 'token' }, { get: () => '1d', getOrThrow: () => 'x'.repeat(64) });
  for (let index = 0; index < 10; index += 1) auth.recordFailedLogin(`ip-${index}`, 'account@example.invalid');
  assert.throws(() => auth.checkLoginLimit('new-ip', 'account@example.invalid'), /Too many login attempts/);
  auth.loginAttempts.clear();
  for (let index = 0; index < 10_001; index += 1) {
    auth.loginAttempts.set(`entry-${index}`, { count: 1, resetAt: Date.now() + 60_000 });
  }
  auth.pruneLoginAttempts();
  assert.equal(auth.loginAttempts.size, 10_000);

  const strategy = new JwtStrategy(
    { getOrThrow: () => 'x'.repeat(64) },
    { findById: async () => ({ id: 'user', isActive: true, deletedAt: null, sessionVersion: 2 }) },
  );
  await expectRejected(
    () => strategy.validate({ sub: 'user', csrfToken: 'csrf', sessionVersion: 1 }),
    'Session has been invalidated',
  );

  console.log('Security regression checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
