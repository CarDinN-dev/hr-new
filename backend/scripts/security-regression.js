const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { plainToInstance } = require('class-transformer');
const { validateSync } = require('class-validator');
const {
  AccessScopeType,
  AttendanceStatus,
  DocumentVisibility,
  PermissionOverrideEffect,
  RoleProtection,
} = require('@prisma/client');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { listArgs } = require('../dist/common/utils/crud.util');
const { PaginationQueryDto } = require('../dist/common/dto/pagination-query.dto');
const { PermissionsGuard } = require('../dist/modules/authorization/permissions.guard');
const { AuthorizationService } = require('../dist/modules/authorization/authorization.service');
const { AttendanceService } = require('../dist/modules/attendance/attendance.service');
const { AuthService, sessionTokenFromRequest } = require('../dist/modules/auth/auth.service');
const { JwtStrategy } = require('../dist/modules/auth/strategies/jwt.strategy');
const { MicrosoftAuthService } = require('../dist/modules/auth/microsoft-auth.service');
const { DocumentsService } = require('../dist/modules/documents/documents.service');
const { LoansService } = require('../dist/modules/loans/loans.service');
const { LeaveService } = require('../dist/modules/leave/leave.service');
const { PayrollService } = require('../dist/modules/payroll/payroll.service');
const { EmploymentContractsService } = require('../dist/modules/employment-contracts/employment-contracts.service');
const { PerformanceReviewsService } = require('../dist/modules/performance-reviews/performance-reviews.service');
const { SystemService } = require('../dist/modules/system/system.service');
const { SystemController } = require('../dist/modules/system/system.controller');
const { AuditController } = require('../dist/modules/audit/audit.controller');
const { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY, SUPER_ADMIN_ONLY_KEY, SYSTEM_ADMINISTRATOR_ONLY_KEY } = require('../dist/common/decorators/permissions.decorator');
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
      if (key === SUPER_ADMIN_ONLY_KEY) return metadata.superAdminOnly;
      if (key === SYSTEM_ADMINISTRATOR_ONLY_KEY) return metadata.systemAdministratorOnly;
      return undefined;
    },
  };
}

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

test('Super Administrators bypass step-up authentication while other roles do not', () => {
  const authorization = new AuthorizationService({});
  assert.doesNotThrow(() => authorization.requireRecentStepUp(user({ isSuperAdmin: true, reauthenticatedAt: new Date(0) })));
  assert.throws(() => authorization.requireRecentStepUp(user({ reauthenticatedAt: new Date(0) })), /Recent authentication is required/);
});

test('permissions catalogue rejects pagination parameters', () => {
  const controller = new SystemController({ listPermissions: () => ['permission.read'] });
  assert.deepEqual(controller.permissions({}, {}), ['permission.read']);
  assert.throws(() => controller.permissions({ page: '1' }, {}), { status: 400 });
  assert.throws(() => controller.permissions({ limit: '100' }, {}), { status: 400 });
});

test('System APIs require an active ADMIN or SUPER_ADMIN role before endpoint permissions', async () => {
  assert.equal(Reflect.getMetadata(SYSTEM_ADMINISTRATOR_ONLY_KEY, SystemController), true);
  for (const method of ['policy', 'updatePolicy', 'holds', 'createHold', 'releaseHold']) {
    assert.equal(Reflect.getMetadata(SUPER_ADMIN_ONLY_KEY, AuditController.prototype[method]), true, `audit configuration method ${method} must be Super Admin only`);
  }

  const guard = new PermissionsGuard(reflector({ systemAdministratorOnly: true, all: ['user.read'] }), {}, audit);
  const legacyPermissions = ['system.configure', 'user.read', 'role.read', 'permission.read', 'session.manage'];
  await assert.rejects(
    guard.canActivate(executionContext(user({ roles: ['CUSTOM_ROLE'], permissions: legacyPermissions }))),
    /Active Administrator role required/,
  );
  await assert.rejects(
    guard.canActivate(executionContext(user({ roles: ['SUPER_ADMIN'], isSuperAdmin: false, permissions: legacyPermissions }))),
    /Active Administrator role required/,
  );
  assert.equal(await guard.canActivate(executionContext(user({ roles: ['ADMIN'], permissions: ['user.read'] }))), true);
  await assert.rejects(
    guard.canActivate(executionContext(user({ roles: ['SUPER_ADMIN'], isSuperAdmin: true }))),
    /Insufficient permission/,
  );
  assert.equal(await guard.canActivate(executionContext(user({
    roles: ['SUPER_ADMIN'], isSuperAdmin: true, permissions: ['user.read'], rolePermissions: ['user.read'],
  }))), true);
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
  let userQuery;
  const service = new AuthorizationService({ user: { findUnique: async (query) => { userQuery = query; return record; } } });
  const context = service.toRequestUser(await service.loadUserContext('user-1'), { id: 'session-1', csrfToken: 'csrf', provider: 'local' });
  assert.equal(userQuery.select.roles.where.revokedAt, null);
  assert.equal(userQuery.select.roles.where.role.isActive, true);
  assert.ok(userQuery.select.roles.where.OR.some((condition) => condition.expiresAt?.gt instanceof Date));
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
  assert.equal(attendance.companyDay(new Date('2026-07-13T21:30:00Z')).toISOString(), '2026-07-14T00:00:00.000Z');
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
