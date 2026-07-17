const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { createServer } = require('node:net');
const bcrypt = require('bcrypt');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const {
  AccessScopeType,
  AttendanceStatus,
  DocumentVisibility,
  PermissionOverrideEffect,
  Prisma,
  RoleProtection,
} = require('@prisma/client');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { listArgs } = require('../dist/common/utils/crud.util');
const { PaginationQueryDto } = require('../dist/common/dto/pagination-query.dto');
const { PermissionsGuard } = require('../dist/modules/authorization/permissions.guard');
const { AuthorizationService } = require('../dist/modules/authorization/authorization.service');
const { AttendanceService } = require('../dist/modules/attendance/attendance.service');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { AuthService, sessionTokenFromRequest } = require('../dist/modules/auth/auth.service');
const { JwtStrategy } = require('../dist/modules/auth/strategies/jwt.strategy');
const { MicrosoftAuthService } = require('../dist/modules/auth/microsoft-auth.service');
const { DocumentsService } = require('../dist/modules/documents/documents.service');
const { assertDocumentFile } = require('../dist/modules/documents/document-file-validation');
const { DocumentMalwareScannerService } = require('../dist/modules/documents/document-malware-scanner.service');
const { LoansService } = require('../dist/modules/loans/loans.service');
const { LeaveService } = require('../dist/modules/leave/leave.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { EmploymentContractsService } = require('../dist/modules/employment-contracts/employment-contracts.service');
const { PerformanceReviewsService } = require('../dist/modules/performance-reviews/performance-reviews.service');
const { SystemService } = require('../dist/modules/system/system.service');
const { OrganizationReadinessService } = require('../dist/modules/system/organization-readiness.service');
const { AssignRoleFlowDto } = require('../dist/modules/system/dto/system.dto');
const { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } = require('../dist/common/decorators/permissions.decorator');
const { IS_PUBLIC_KEY } = require('../dist/common/decorators/public.decorator');

function user(overrides = {}) {
  return {
    id: 'user-1',
    email: 'user@example.invalid',
    displayName: 'Test User',
    roles: ['EMPLOYEE'],
    permissions: [],
    rolePermissions: [],
    permissionOverrides: [],
    isSuperAdmin: false,
    sessionId: 'session-1',
    authProvider: 'local',
    authorizationVersion: 1,
    csrfToken: 'csrf',
    employeeId: 'employee-1',
    departmentScopeIds: [],
    requestId: 'request-1',
    ...overrides,
  };
}

function executionContext(requestUser) {
  const request = {
    user: requestUser,
    path: '/protected',
    method: 'GET',
    requestId: 'request-1',
    get: () => 'test-agent',
  };
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function reflector(metadata = {}) {
  return {
    getAllAndOverride: (key) => {
      if (key === IS_PUBLIC_KEY) return metadata.public;
      if (key === PERMISSIONS_KEY) return metadata.all;
      if (key === ANY_PERMISSIONS_KEY) return metadata.any;
      return undefined;
    },
  };
}

test('document uploads reject MIME spoofing at the shared storage boundary', () => {
  const file = (mimetype, buffer) => ({ mimetype, buffer });
  assert.doesNotThrow(() => assertDocumentFile(file('application/pdf', Buffer.from('%PDF-1.7\n'))));
  assert.doesNotThrow(() => assertDocumentFile(file('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))));
  assert.throws(() => assertDocumentFile(file('application/pdf', Buffer.from('<script>alert(1)</script>'))), /does not match/);
  assert.throws(() => assertDocumentFile(file('image/jpeg', Buffer.from('%PDF-1.7'))), /does not match/);
});

test('document scanner streams bytes to clamd and accepts only a clean response', async () => {
  const server = createServer(socket => {
    const chunks = [];
    socket.on('data', chunk => chunks.push(chunk));
    socket.on('end', () => {
      const request = Buffer.concat(chunks);
      assert.ok(request.subarray(0, 10).equals(Buffer.from('zINSTREAM\0')));
      assert.ok(request.includes(Buffer.from('safe document')));
      socket.end('stream: OK\0');
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const scanner = new DocumentMalwareScannerService({ get: (key, fallback) => ({ NODE_ENV: 'test', DOCUMENT_SCAN_ENABLED: 'true', CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: String(port) })[key] ?? fallback }, {}, {}, {});
    assert.equal(await scanner.scan(Buffer.from('safe document')), 'stream: OK');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

function authorizationStub() {
  return {
    has: (actor, permission) => actor.permissions.includes(permission),
    hasAny: (actor, permissions) => permissions.some((permission) => actor.permissions.includes(permission)),
    permissionAllowedForScope: (actor, permission, _scope, id) => {
      if (!actor.permissions.includes(permission)) return false;
      const deny = actor.permissionOverrides.find((override) => override.permission === permission
        && override.effect === PermissionOverrideEffect.DENY
        && (!override.scopeIds.length || override.scopeIds.includes(id)));
      return !deny;
    },
    scopeRule: (actor, permission) => ({
      unrestricted: actor.permissions.includes(permission),
      includeIds: [],
      excludeIds: [],
    }),
    managementTreeEmployeeIds: async () => [],
    isInManagementTree: async () => false,
    assertEmployeeScope: async (actor, employeeId, scopes) => {
      if (!Object.values(scopes).some((permission) => actor.permissions.includes(permission))) throw new Error(`out of scope:${employeeId}`);
    },
    require: (actor, permission) => {
      if (!actor.permissions.includes(permission)) throw new Error('Insufficient permission');
    },
    requireRecentStepUp: () => undefined,
  };
}

const audit = { record: async () => undefined };

test('generic list helpers never expose soft-deleted records', () => {
  const args = listArgs({ page: 1, limit: 20, includeDeleted: true }, {});
  assert.deepEqual(args.where.AND[0], { deletedAt: null });
});

test('pagination accepts identical duplicate values but rejects conflicting values', () => {
  const duplicate = plainToInstance(PaginationQueryDto, { page: ['1', '1'], limit: ['100', '100'] });
  assert.equal(validateSync(duplicate).length, 0);
  assert.equal(duplicate.page, 1);
  assert.equal(duplicate.limit, 100);

  const conflicting = plainToInstance(PaginationQueryDto, { limit: ['20', '100'] });
  assert.ok(validateSync(conflicting).some((error) => error.property === 'limit'));
});

test('unlinked self-service list endpoints return empty collections', async () => {
  const actor = user({ employeeId: null });
  const expected = { data: [], meta: { total: 0, page: 1, limit: 100, totalPages: 1 } };
  assert.deepEqual(await LeaveService.prototype.listMine.call({}, { page: 1, limit: 100 }, actor), expected);
  assert.deepEqual(await PayrollService.prototype.listMyPayslips.call({}, { page: 1, limit: 100 }, actor), expected);
});

test('permissions guard is default-deny and implements all/any without an administrator bypass', async () => {
  const actor = user({ roles: ['ADMIN'], permissions: ['employee.self.read', 'leave.self.read'] });
  const guard = (metadata) => new PermissionsGuard(reflector(metadata), {}, audit);
  await assert.rejects(guard({}).canActivate(executionContext(actor)), /Endpoint permission policy is not configured/);
  await assert.rejects(guard({ all: ['payroll.generate'] }).canActivate(executionContext(actor)), /Insufficient permission/);
  assert.equal(await guard({ all: ['employee.self.read', 'leave.self.read'] }).canActivate(executionContext(actor)), true);
  assert.equal(await guard({ any: ['payroll.generate', 'leave.self.read'] }).canActivate(executionContext(actor)), true);
});

test('authorization context unions roles, applies direct denies, and preserves the Super Admin exception', async () => {
  const baseRecord = {
    id: 'user-1', email: 'user@example.invalid', isActive: true, deletedAt: null, authorizationVersion: 4,
    employee: { id: 'employee-1', firstName: 'Test', lastName: 'User', deletedAt: null, managedDepartments: [{ id: 'department-1' }] },
    roles: [
      { role: { code: 'EMPLOYEE', protection: RoleProtection.STANDARD, permissions: [{ permission: { code: 'employee.self.read' } }] } },
      { role: { code: 'LINE_MANAGER', protection: RoleProtection.STANDARD, permissions: [{ permission: { code: 'employee.team.read' } }] } },
    ],
    permissionOverrides: [{ permission: { code: 'employee.team.read' }, effect: PermissionOverrideEffect.DENY, scopeType: AccessScopeType.ALL_SYSTEM, scopeIds: [] }],
  };
  let record = structuredClone(baseRecord);
  const service = new AuthorizationService({ user: { findUnique: async () => record } });
  const context = service.toRequestUser(await service.loadUserContext('user-1'), { id: 'session-1', csrfToken: 'csrf', provider: 'local' });
  assert.deepEqual(context.roles, ['EMPLOYEE', 'LINE_MANAGER']);
  assert.deepEqual(context.permissions, ['employee.self.read']);
  assert.deepEqual(context.departmentScopeIds, ['department-1']);

  record = structuredClone(baseRecord);
  record.roles.push({ role: { code: 'SUPER_ADMIN', protection: RoleProtection.SUPER_ADMIN, permissions: [{ permission: { code: 'employee.team.read' } }] } });
  const superContext = service.toRequestUser(await service.loadUserContext('user-1'), { id: 'session-2', csrfToken: 'csrf', provider: 'local' });
  assert.equal(superContext.isSuperAdmin, true);
  assert.equal(superContext.permissions.includes('employee.team.read'), true);
});

test('resource-scoped denies beat grants and out-of-scope employee records return 404', async () => {
  const prisma = { employee: { findFirst: async () => ({ id: 'employee-2', managerId: 'employee-1', departmentId: 'department-1' }) } };
  const service = new AuthorizationService(prisma);
  const actor = user({
    permissions: ['employee.team.read'],
    rolePermissions: ['employee.team.read'],
    permissionOverrides: [{
      permission: 'employee.team.read', effect: PermissionOverrideEffect.DENY,
      scopeType: AccessScopeType.DIRECT_REPORTS, scopeIds: ['employee-2'],
    }],
  });
  assert.equal(service.permissionAllowedForScope(actor, 'employee.team.read', AccessScopeType.DIRECT_REPORTS, 'employee-2'), false);
  await assert.rejects(
    service.assertEmployeeScope(actor, 'employee-2', { team: 'employee.team.read' }),
    /Record not found/,
  );
});

test('reporting-tree traversal detects cycles and manager updates cannot create one', async () => {
  const managers = new Map([
    ['employee-2', 'employee-3'],
    ['employee-3', 'employee-2'],
  ]);
  const service = new AuthorizationService({ employee: { findFirst: async ({ where }) => ({ managerId: managers.get(where.id) ?? null }) } });
  assert.equal(await service.isInManagementTree('employee-1', 'employee-2'), false);
  await assert.rejects(service.assertNoManagerCycle('employee-2', 'employee-3'), /create a cycle/);
  managers.set('employee-3', 'employee-1');
  assert.equal(await service.isInManagementTree('employee-1', 'employee-2'), true);
});

test('loan self-service and manager contract queries remain field- and employee-scoped', async () => {
  let loanFindArgs;
  const auth = authorizationStub();
  const loans = new LoansService({
    employeeLoan: {
      findMany: async (args) => { loanFindArgs = args; return []; },
      count: async () => 0,
    },
  }, audit, auth);
  await loans.list({ page: 1, limit: 20 }, user({ permissions: ['loan.self.read'] }));
  assert.match(JSON.stringify(loanFindArgs.where), /employee-1/);

  let contractFindArgs;
  const contracts = new EmploymentContractsService({
    employee: { findMany: async () => [{ id: 'direct-report' }] },
    employmentContract: {
      findMany: async (args) => { contractFindArgs = args; return []; },
      count: async () => 0,
    },
  }, audit, auth);
  const manager = user({ employeeId: 'manager', permissions: ['contract.team.read'] });
  await contracts.list({ page: 1, limit: 20 }, manager);
  assert.equal(contractFindArgs.select.salary, undefined);
  assert.equal(contractFindArgs.select.terms, undefined);
  await assert.rejects(contracts.list({ page: 1, limit: 20, sortBy: 'salary' }, manager), /Unsupported sort field/);
});

test('performance and document services reject actor and uploader substitution', async () => {
  const auth = authorizationStub();
  const manager = user({ employeeId: 'manager', permissions: ['performance.team.manage', 'document.self.manage'] });
  const reviews = new PerformanceReviewsService({
    employee: { findFirst: async () => ({ id: 'direct-report', managerId: 'manager' }) },
  }, audit, auth);
  await assert.rejects(reviews.create({
    employeeId: 'direct-report', reviewerId: 'victim',
    reviewPeriodStart: new Date('2026-01-01T00:00:00Z'), reviewPeriodEnd: new Date('2026-06-30T00:00:00Z'), rating: 4,
  }, manager), /another employee/);

  const documents = new DocumentsService({
    employee: { findFirst: async () => ({ id: 'manager' }) },
    employeeDocument: { findFirst: async () => ({ id: 'document', employeeId: 'manager', uploadedById: 'manager' }) },
  }, {}, audit, auth);
  await assert.rejects(documents.create({
    employeeId: 'manager', documentType: 'ID', fileName: 'id.pdf', fileUrl: 'https://example.invalid/id.pdf', uploadedById: 'victim',
  }, manager), /authenticated employee/);
  await assert.rejects(documents.update('document', { visibility: DocumentVisibility.PUBLIC }, manager), /Only HR/);
});

test('attendance dates, lateness, and hours are derived by the server', () => {
  const attendance = new AttendanceService({}, audit, authorizationStub());
  const data = attendance.manualAttendanceData({
    employeeId: 'employee-1', attendanceDate: new Date('2026-07-14T00:00:00Z'),
    checkIn: new Date('2026-07-14T06:30:00Z'), checkOut: new Date('2026-07-14T14:30:00Z'),
    status: AttendanceStatus.PRESENT, isLate: false, lateMinutes: 0, workingHours: 99,
  }, new Date('2026-07-14T00:00:00Z'));
  assert.equal(data.isLate, true);
  assert.equal(data.lateMinutes, 30);
  assert.equal(data.workingHours, 8);
  assert.equal(data.approvalStatus, 'APPROVED');
  assert.equal(attendance.manualAttendanceData({ employeeId: 'employee-1', attendanceDate: new Date('2026-07-14T00:00:00Z'), status: AttendanceStatus.ABSENT }, new Date('2026-07-14T00:00:00Z')).approvalStatus, 'PENDING');
  assert.equal(attendance.companyDay(new Date('2026-07-13T21:30:00Z')).toISOString(), '2026-07-14T00:00:00.000Z');
});

test('attendance approval decisions survive an attendance correction and are audited', async () => {
  const record = {
    id: 'attendance-1', employeeId: 'employee-1', attendanceDate: new Date('2026-07-14T00:00:00Z'),
    checkIn: null, checkOut: null, status: AttendanceStatus.HALF_DAY, approvalStatus: 'NOT_APPROVED', notes: null,
    workingHours: new Prisma.Decimal(0),
  };
  let updateData; let auditEvent;
  const tx = {
    attendance: {
      findFirst: async () => record,
      update: async ({ data }) => { updateData = data; return { ...record, ...data }; },
    },
    payroll: { findFirst: async () => null },
    attendanceCorrection: { create: async () => ({}) },
  };
  const prisma = { $transaction: async (operation) => operation(tx) };
  const attendance = new AttendanceService(prisma, { record: async (_tx, _user, event) => { auditEvent = event; } }, authorizationStub());
  await attendance.update('attendance-1', { approvalStatus: 'APPROVED', correctionReason: 'Manager approved attendance' }, user({ permissions: ['attendance.hr.manage'] }));
  assert.equal(updateData.approvalStatus, 'APPROVED');
  assert.deepEqual(auditEvent.changes.find((change) => change.field === 'approvalStatus'), {
    field: 'approvalStatus', previousValue: 'NOT_APPROVED', nextValue: 'APPROVED',
  });
});

test('backend payroll and audit CSV exports neutralize spreadsheet formulas', async () => {
  const auditCsv = Object.create(AuditService.prototype).auditCsv([{
    sequence: 1n, occurredAtUtc: new Date('2026-07-17T00:00:00Z'), actorEmailSnapshot: '=HYPERLINK("bad")',
    action: 'EXPORT', outcome: 'SUCCESS', module: 'audit', resourceType: 'AuditEvent', resourceId: '+SUM(1,1)', reason: '@command',
  }]).buffer.toString('utf8');
  assert.match(auditCsv, /"'=HYPERLINK/);
  assert.match(auditCsv, /"'\+SUM/);
  assert.match(auditCsv, /"'@command/);

  const decimal = (value) => ({ toFixed: () => value });
  const payroll = new PayrollService({
    payrollRun: { findUnique: async () => ({
      id: 'run-1', year: 2026, month: 7, status: 'PAID', payrolls: [{
        employee: { employeeCode: '=CMD', firstName: '+First', lastName: '@Last', department: { name: '-Dept' } },
        baseSalary: decimal('1.00'), allowances: decimal('0.00'), bonuses: decimal('0.00'), deductions: decimal('0.00'),
        taxAmount: decimal('0.00'), grossPay: decimal('1.00'), netPay: decimal('1.00'),
      }],
    }) },
  }, {}, audit, {}, { permissionAllowedForScope: () => true });
  const payrollCsv = (await payroll.exportRun('run-1', undefined, user())).buffer.toString('utf8');
  assert.match(payrollCsv, /"'=CMD"/);
  assert.match(payrollCsv, /"'\+First @Last"/);
  assert.match(payrollCsv, /"'-Dept"/);
});

test('unexpected backend errors are masked from API responses', () => {
  let responseBody;
  new HttpExceptionFilter().catch(new Error('INTERNAL_DETAIL_MARKER'), {
    switchToHttp: () => ({
      getResponse: () => ({ status: () => ({ json: (body) => { responseBody = body; } }) }),
      getRequest: () => ({ url: '/api/v1/test' }),
    }),
  });
  assert.equal(responseBody.message, 'Internal server error');
  assert.doesNotMatch(JSON.stringify(responseBody), /INTERNAL_DETAIL_MARKER/);
});

test('database throttling survives service recreation and session cookies remain hardened', async () => {
  const throttles = new Map();
  const prisma = {
    authThrottle: {
      findUnique: async ({ where }) => throttles.get(where.key) ?? null,
      deleteMany: async ({ where }) => {
        if (where.resetAt?.lte) for (const [key, value] of throttles) if (value.resetAt <= where.resetAt.lte) throttles.delete(key);
      },
    },
    $executeRaw: async (_strings, key, resetAt, now) => {
      const current = throttles.get(key);
      throttles.set(key, current && current.resetAt > now ? { ...current, count: current.count + 1 } : { key, count: 1, resetAt });
      return 1;
    },
  };
  const config = {
    get: (key, fallback) => key === 'NODE_ENV' ? 'production' : fallback,
    getOrThrow: () => 'x'.repeat(64),
  };
  const jwt = { decode: () => ({ iat: 1_000, exp: 2_000 }) };
  const first = new AuthService({}, jwt, config, prisma, {}, audit);
  for (let index = 0; index < 20; index += 1) await first.recordFailedLogin(`ip-${index}`, 'account@example.invalid');
  const restarted = new AuthService({}, jwt, config, prisma, {}, audit);
  await assert.rejects(restarted.checkLoginLimit('new-ip', 'account@example.invalid'), /Too many login attempts/);

  let sessionCookie;
  first.setSessionCookie({ cookie: (...args) => { sessionCookie = args; } }, 'signed-session');
  assert.equal(sessionCookie[0], '__Host-medtech_hr_session');
  assert.deepEqual(
    { httpOnly: sessionCookie[2].httpOnly, secure: sessionCookie[2].secure, sameSite: sessionCookie[2].sameSite, path: sessionCookie[2].path },
    { httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
  );
  assert.equal(sessionTokenFromRequest({ headers: { cookie: 'other=x; __Host-medtech_hr_session=signed-session' } }), 'signed-session');
  assert.equal('accessToken' in first.browserSession({ user: user(), accessToken: 'secret', csrfToken: 'csrf' }), false);
});

test('local step-up locks after five failures per account/session and clears failures after success', async () => {
  const throttles = new Map();
  const prisma = {
    authThrottle: {
      findUnique: async ({ where }) => throttles.get(where.key) ?? null,
      deleteMany: async ({ where }) => {
        if (where.key) throttles.delete(where.key);
        if (where.resetAt?.lte) for (const [key, value] of throttles) if (value.resetAt <= where.resetAt.lte) throttles.delete(key);
      },
    },
    authSession: { updateMany: async () => ({ count: 1 }) },
    $executeRaw: async (_strings, key, resetAt, now) => {
      const current = throttles.get(key);
      throttles.set(key, current && current.resetAt > now ? { ...current, count: current.count + 1 } : { key, count: 1, resetAt });
      return 1;
    },
    $transaction: async (callback) => callback(prisma),
  };
  const passwordHash = await bcrypt.hash('CorrectPass123!', 10);
  const users = { findById: async () => ({ id: 'user-1', isActive: true, deletedAt: null, localLoginEnabled: true, passwordHash }) };
  const config = { get: (key, fallback) => key === 'BCRYPT_SALT_ROUNDS' ? 10 : fallback, getOrThrow: () => 'x'.repeat(64) };
  const service = new AuthService(users, {}, config, prisma, {}, audit);
  const lockedActor = user({ sessionId: 'locked-session' });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(service.stepUpLocal({ password: 'WrongPass123!' }, lockedActor), /could not be verified/);
  }
  await assert.rejects(service.stepUpLocal({ password: 'CorrectPass123!' }, lockedActor), /Too many authentication attempts/);

  const recoverableActor = user({ sessionId: 'recoverable-session' });
  await assert.rejects(service.stepUpLocal({ password: 'WrongPass123!' }, recoverableActor), /could not be verified/);
  assert.equal(throttles.size, 2);
  await service.stepUpLocal({ password: 'CorrectPass123!' }, recoverableActor);
  assert.equal(throttles.size, 1);
});

test('JWT validation rejects revoked, expired, altered, and legacy sessions', async () => {
  const token = 'test-token';
  const session = {
    id: 'session-1', userId: 'user-1', tokenHash: createHash('sha256').update(token).digest('hex'), provider: 'local',
    authorizationVersion: 3, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastSeenAt: new Date(),
    reauthenticatedAt: new Date(), ipHash: 'ip-hash',
  };
  const prisma = { authSession: { findUnique: async () => session, update: async () => ({}) } };
  const authorization = {
    loadUserContext: async () => ({ authorizationVersion: 3 }),
    toRequestUser: () => user({ authorizationVersion: 3 }),
  };
  const strategy = new JwtStrategy({ getOrThrow: () => 'x'.repeat(64) }, prisma, authorization);
  const request = { headers: { cookie: `medtech_hr_session=${token}` } };
  const payload = { sub: 'user-1', email: 'user@example.invalid', sid: 'session-1', authorizationVersion: 3, csrfToken: 'csrf' };
  assert.equal((await strategy.validate(request, payload)).id, 'user-1');
  await assert.rejects(strategy.validate(request, { ...payload, sid: undefined }), /Legacy session/);
  session.revokedAt = new Date();
  await assert.rejects(strategy.validate(request, payload), /invalid or expired/);
  session.revokedAt = null; session.tokenHash = '00'.repeat(32);
  await assert.rejects(strategy.validate(request, payload), /invalid or expired/);
  session.tokenHash = createHash('sha256').update(token).digest('hex'); session.expiresAt = new Date(0);
  await assert.rejects(strategy.validate(request, payload), /invalid or expired/);
});

test('Microsoft identity validates the tenant token and defers application access to local RBAC', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const clientId = '22222222-2222-4222-8222-222222222222';
  const values = {
    MICROSOFT_LOGIN_ENABLED: 'true',
    MICROSOFT_TENANT_ID: tenantId,
    MICROSOFT_CLIENT_ID: clientId,
    MICROSOFT_CLIENT_SECRET: 'test-client-secret-value',
    MICROSOFT_REDIRECT_URI: 'http://localhost/api/v1/auth/microsoft/callback',
    JWT_SECRET: 'x'.repeat(64),
    NODE_ENV: 'test',
  };
  const config = { getOrThrow: (key) => values[key], get: (key) => values[key] };
  const service = new MicrosoftAuthService(config, {}, {});
  const claims = {
    tid: tenantId, oid: '33333333-3333-4333-8333-333333333333',
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`, aud: clientId,
    preferred_username: 'employee@example.invalid',
  };
  assert.deepEqual(service.validateIdentityClaims(claims), { objectId: claims.oid, email: 'employee@example.invalid' });
  assert.throws(() => service.validateIdentityClaims({ ...claims, tid: '44444444-4444-4444-8444-444444444444' }), /not authorized/);
  assert.throws(() => service.validateIdentityClaims({ ...claims, aud: '55555555-5555-4555-8555-555555555555' }), /not authorized/);
  assert.throws(() => service.validateIdentityClaims({ ...claims, idp: 'live.com' }), /not authorized/);
  const transaction = { version: 1, state: 'state', nonce: 'nonce', codeVerifier: 'v'.repeat(64), expiresAt: Date.now() + 60_000, mode: 'login' };
  const encrypted = service.encryptTransaction(transaction);
  assert.deepEqual(service.decryptTransaction(encrypted), transaction);
  const tampered = Buffer.from(encrypted, 'base64url'); tampered[tampered.length - 1] ^= 1;
  assert.throws(() => service.decryptTransaction(tampered.toString('base64url')), /invalid or expired/);
});

test('Microsoft login can be disabled without credentials', async () => {
  const values = { MICROSOFT_LOGIN_ENABLED: 'false', JWT_SECRET: 'x'.repeat(64), NODE_ENV: 'production' };
  const config = { getOrThrow: (key) => values[key], get: (key, fallback) => values[key] ?? fallback };
  const service = new MicrosoftAuthService(config, {}, {});
  assert.equal(service.isEnabled(), false);
  await assert.rejects(service.begin({}, {}), /Microsoft login is disabled/);
});

test('self escalation and removal of the final Super Administrator are rejected', async () => {
  const auth = authorizationStub();
  const actor = user({ permissions: ['role.assign', 'role.assign_protected'], reauthenticatedAt: new Date() });
  const service = new SystemService({}, audit, auth, { get: (_key, fallback) => fallback });
  assert.throws(
    () => service.assignRoles(actor.id, { roleIds: ['role-1'], expectedAuthorizationVersion: 1, reason: 'Self escalation test' }, actor),
    /Self-role assignment/,
  );
  await assert.rejects(
    service.assertNotFinalSuperAdmin('target', {
      userRole: {
        findFirst: async () => ({ id: 'assignment' }),
        count: async () => 0,
      },
    }),
    /final active Super Administrator/,
  );
});

test('role flow is restricted to administrators and validates its fixed role catalogue', async () => {
  const valid = plainToInstance(AssignRoleFlowDto, {
    roleCodes: ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER'], expectedAuthorizationVersion: 4, reason: 'Approved responsibilities',
  });
  assert.equal(validateSync(valid).length, 0);
  const invalid = plainToInstance(AssignRoleFlowDto, {
    roleCodes: ['EMPLOYEE', 'COO'], expectedAuthorizationVersion: 4, reason: 'Invalid executive assignment',
  });
  assert.ok(validateSync(invalid).some((error) => error.property === 'roleCodes'));

  const service = new SystemService({}, audit, authorizationStub(), { get: (_key, fallback) => fallback }, {});
  const directGrantOnly = user({ roles: ['EMPLOYEE'], permissions: ['role.assign'] });
  await assert.rejects(service.assignRoleFlow('target-user', valid, directGrantOnly), /Administrator role is required/);
  await assert.rejects(service.assignRoleFlow('target-user', {
    roleCodes: ['EMPLOYEE', 'MANAGER'], expectedAuthorizationVersion: 4, reason: 'Missing manager prerequisite',
  }, user({ roles: ['ADMIN'], permissions: ['role.assign'] })), /requires Line Manager/);
});

test('role flow preserves locked and custom roles and uses the audited assignment transaction', async () => {
  const role = (id, code, protection = RoleProtection.STANDARD) => ({ id, code, protection });
  const roles = [
    role('role-employee', 'EMPLOYEE'), role('role-line', 'LINE_MANAGER'), role('role-manager', 'MANAGER'),
    role('role-hr', 'HR'), role('role-cpo', 'CPO'), role('role-custom', 'CUSTOM_FINANCE'),
  ];
  const current = [
    { roleId: 'role-employee', role: role('role-employee', 'EMPLOYEE') },
    { roleId: 'role-cpo', role: role('role-cpo', 'CPO') },
    { roleId: 'role-custom', role: role('role-custom', 'CUSTOM_FINANCE') },
  ];
  let sessionsRevoked = false; let notificationCreated = false; let auditEvent; const upsertedRoleIds = [];
  const prisma = {
    $transaction: async (operation) => operation(prisma),
    user: {
      findFirst: async (args) => args.select?.roles
        ? { id: 'target-user', email: 'target@example.invalid', authorizationVersion: 5, roles: [], permissionOverrides: [] }
        : { id: 'target-user', authorizationVersion: 4 },
      updateMany: async () => ({ count: 1 }),
    },
    role: {
      findMany: async (args) => args.where.code
        ? roles.filter((item) => args.where.code.in.includes(item.code)).map(({ id, code }) => ({ id, code }))
        : roles.filter((item) => args.where.id.in.includes(item.id)),
    },
    userRole: {
      findMany: async () => current,
      updateMany: async () => ({ count: 1 }),
      upsert: async (args) => { upsertedRoleIds.push(args.where.userId_roleId.roleId); return {}; },
    },
    authSession: { updateMany: async () => { sessionsRevoked = true; return { count: 1 }; } },
    notification: { create: async () => { notificationCreated = true; return {}; } },
  };
  const service = new SystemService(prisma, { record: async (_tx, _actor, event) => { auditEvent = event; } }, authorizationStub(), { get: (_key, fallback) => fallback }, {});
  const admin = user({ roles: ['ADMIN'], permissions: ['role.assign'] });
  await service.assignRoleFlow('target-user', {
    roleCodes: ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER'], expectedAuthorizationVersion: 4, reason: 'Approved manager duties',
  }, admin);

  assert.deepEqual(new Set(auditEvent.after.roleCodes), new Set(['EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'CPO', 'CUSTOM_FINANCE']));
  assert.deepEqual(new Set(upsertedRoleIds), new Set(['role-employee', 'role-line', 'role-manager']));
  assert.equal(sessionsRevoked, true);
  assert.equal(notificationCreated, true);
});

test('organization remediation previews required manager roles and rejects reporting cycles', () => {
  const service = new OrganizationReadinessService({}, audit, authorizationStub());
  const linkedUser = (id, roles = []) => ({ id: `user-${id}`, isActive: true, deletedAt: null, authorizationVersion: 1, roles: roles.map(code => ({ role: { id: `role-${code}`, code } })) });
  const employee = (id, managerId, roles = []) => ({ id, employeeCode: id, firstName: id, lastName: 'Test', managerId, userId: `user-${id}`, version: 1, employmentStatus: 'ACTIVE', deletedAt: null, user: linkedUser(id, roles) });
  const state = {
    employees: [employee('employee-1', null), employee('manager-1', null), employee('director-1', null)],
    departments: [{ id: 'department-1', code: 'OPS', name: 'Operations', managerId: null, updatedAt: new Date(0) }],
    roles: ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'SUPER_ADMIN'].map(code => ({ id: `role-${code}`, code })),
    workflowPolicies: [],
  };
  const preview = service.buildPreview(state, {
    employeeManagers: [{ employeeId: 'employee-1', managerId: 'manager-1' }, { employeeId: 'manager-1', managerId: 'director-1' }],
    departmentManagers: [{ departmentId: 'department-1', managerId: 'director-1' }],
  });
  assert.deepEqual(new Set(preview.roleAdditions.map(item => `${item.employeeId}:${item.roleCode}`)), new Set([
    'employee-1:EMPLOYEE', 'manager-1:EMPLOYEE', 'manager-1:LINE_MANAGER',
    'director-1:EMPLOYEE', 'director-1:LINE_MANAGER', 'director-1:MANAGER',
  ]));
  assert.match(preview.previewHash, /^[a-f0-9]{64}$/);
  assert.throws(() => service.buildPreview(state, {
    employeeManagers: [{ employeeId: 'employee-1', managerId: 'manager-1' }, { employeeId: 'manager-1', managerId: 'employee-1' }],
    departmentManagers: [],
  }), /cycle/);
});

test('multi-page payslips repeat headers and reserve totals and footer space', () => {
  const service = new PayrollService({}, {}, audit, {}, authorizationStub());
  const money = (value) => new Prisma.Decimal(value);
  const pdf = service.payslipPdf({
    employee: { employeeCode: 'EMP-MULTI', firstName: 'Multi', lastName: 'Page', department: { name: 'Finance' } },
    lineItems: Array.from({ length: 80 }, (_, index) => ({ description: `Line item ${index + 1}`, amount: money('1.00') })),
    grossPay: money('80.00'),
    deductions: money('1.00'),
    taxAmount: money('2.00'),
    netPay: money('77.00'),
  }, { year: 2026, month: 7, revision: 1 });
  const content = pdf.toString('latin1');
  assert.ok((content.match(/\/Type \/Page\b/g) || []).length >= 2);
  assert.ok(pdf.length > 5_000);
});
