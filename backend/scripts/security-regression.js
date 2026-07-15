const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');
const { AttendanceStatus, DocumentVisibility, LegacyRole } = require('@prisma/client');
const { HttpExceptionFilter } = require('../dist/common/filters/http-exception.filter');
const { listArgs } = require('../dist/common/utils/crud.util');
const { PermissionsGuard } = require('../dist/modules/authorization/permissions.guard');
const { AuthorizationService } = require('../dist/modules/authorization/authorization.service');
const { AttendanceService } = require('../dist/modules/attendance/attendance.service');
const { AuthService, sessionTokenFromRequest } = require('../dist/modules/auth/auth.service');
const { JwtStrategy } = require('../dist/modules/auth/strategies/jwt.strategy');
const { MicrosoftAuthService } = require('../dist/modules/auth/microsoft-auth.service');
const { DocumentsService } = require('../dist/modules/documents/documents.service');
const { LoansService } = require('../dist/modules/loans/loans.service');
const { EmploymentContractsService } = require('../dist/modules/employment-contracts/employment-contracts.service');
const { PerformanceReviewsService } = require('../dist/modules/performance-reviews/performance-reviews.service');
const { SystemService } = require('../dist/modules/system/system.service');
const { ANY_PERMISSIONS_KEY, PERMISSIONS_KEY } = require('../dist/common/decorators/permissions.decorator');
const { IS_PUBLIC_KEY } = require('../dist/common/decorators/public.decorator');
const { createInitialLoginUsers } = require('../prisma/seed');

function user(overrides = {}) {
  return {
    id: 'user-1', email: 'user@example.invalid', displayName: 'Test User', roles: ['EMPLOYEE'],
    permissions: [], sessionId: 'session-1', authorizationVersion: 1, csrfToken: 'csrf',
    employeeId: 'employee-1', departmentScopeIds: [], requestId: 'request-1', ...overrides,
  };
}

function executionContext(requestUser) {
  const request = { user: requestUser, path: '/protected', requestId: 'request-1' };
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

const audit = { record: async () => undefined };

test('generic list helpers never expose soft-deleted records', () => {
  const args = listArgs({ page: 1, limit: 20, includeDeleted: true }, {});
  assert.deepEqual(args.where.AND[0], { deletedAt: null });
});

test('login bootstrap is all-or-nothing and refuses existing accounts', async () => {
  let creates = 0;
  const existingPrisma = {
    $transaction: async (operation) => operation({
      user: {
        findMany: async () => [{ email: 'hr@med-tech.com' }],
        create: async () => { creates += 1; },
      },
    }),
  };
  await assert.rejects(
    createInitialLoginUsers(existingPrisma, [{
      email: 'hr@med-tech.com', passwordHash: 'hash', role: LegacyRole.SUPER_ADMIN,
    }], []),
    /Login bootstrap refused/,
  );
  assert.equal(creates, 0);

  const emptyPrisma = {
    $transaction: async (operation) => operation({
      user: {
        findMany: async () => [],
        create: async () => { creates += 1; },
      },
    }),
  };
  await createInitialLoginUsers(emptyPrisma, [
    { email: 'hr@med-tech.com', passwordHash: 'hash-1', role: LegacyRole.SUPER_ADMIN },
    { email: 'admin@med-tech.com', passwordHash: 'hash-2', role: LegacyRole.HR_ADMIN },
  ], []);
  assert.equal(creates, 2);
});

test('permissions guard is default deny and has no administrator bypass', async () => {
  const prisma = { auditEvent: { create: async () => ({}) } };
  await assert.rejects(
    new PermissionsGuard(reflector(), prisma).canActivate(executionContext(user({ roles: ['SYSTEM_ADMIN'] }))),
    /Endpoint permission policy is not configured/,
  );
  await assert.rejects(
    new PermissionsGuard(reflector({ all: ['payroll.read'] }), prisma).canActivate(executionContext(user({ roles: ['SYSTEM_ADMIN'] }))),
    /Insufficient permission/,
  );
});

test('permissions guard implements all and any semantics', async () => {
  const prisma = { auditEvent: { create: async () => ({}) } };
  const requestUser = user({ permissions: ['employee.self.read', 'leave.self.read'] });
  assert.equal(await new PermissionsGuard(reflector({ all: ['employee.self.read', 'leave.self.read'] }), prisma).canActivate(executionContext(requestUser)), true);
  assert.equal(await new PermissionsGuard(reflector({ any: ['payroll.read', 'leave.self.read'] }), prisma).canActivate(executionContext(requestUser)), true);
  await assert.rejects(
    new PermissionsGuard(reflector({ all: ['employee.self.read', 'payroll.read'] }), prisma).canActivate(executionContext(requestUser)),
    /Insufficient permission/,
  );
});

test('authorization service unions active role permissions and derives department scope', async () => {
  let queryCount = 0;
  const prisma = { user: { findUnique: async () => {
    queryCount += 1;
    return {
      id: 'user-1', email: 'user@example.invalid', isActive: true, deletedAt: null, authorizationVersion: 4,
      employee: { id: 'employee-1', firstName: 'Test', lastName: 'User', deletedAt: null, managedDepartments: [{ id: 'department-1' }] },
      roles: [
        { role: { code: 'EMPLOYEE', permissions: [{ permission: { code: 'employee.self.read' } }] } },
        { role: { code: 'LINE_MANAGER', permissions: [{ permission: { code: 'employee.team.read' } }] } },
      ],
    };
  } } };
  const service = new AuthorizationService(prisma);
  const context = service.toRequestUser(await service.loadUserContext('user-1'), { id: 'session-1', csrfToken: 'csrf' });
  assert.equal(queryCount, 1);
  assert.deepEqual(context.roles, ['EMPLOYEE', 'LINE_MANAGER']);
  assert.deepEqual(context.permissions, ['employee.self.read', 'employee.team.read']);
  assert.deepEqual(context.departmentScopeIds, ['department-1']);
});

test('loan self-service reads are constrained to the linked employee', async () => {
  let findManyArgs;
  let findFirstArgs;
  const prisma = { employeeLoan: {
    findMany: async (args) => { findManyArgs = args; return []; },
    count: async () => 0,
    findFirst: async (args) => { findFirstArgs = args; return null; },
  } };
  const service = new LoansService(prisma, {});
  const requestUser = user({ permissions: ['loan.self.read'] });
  await service.list({ page: 1, limit: 20 }, requestUser);
  await assert.rejects(service.find('another-loan', requestUser), /Loan not found/);
  assert.match(JSON.stringify(findManyArgs.where), /employee-1/);
  assert.match(JSON.stringify(findFirstArgs.where), /employee-1/);
});

test('manager contract queries do not select or sort by salary', async () => {
  let findManyArgs;
  const prisma = { employmentContract: {
    findMany: async (args) => { findManyArgs = args; return []; },
    count: async () => 0,
  } };
  const service = new EmploymentContractsService(prisma);
  await service.list({ page: 1, limit: 20 }, user({ permissions: ['contract.team.read'] }));
  assert.equal(findManyArgs.select.salary, undefined);
  await assert.rejects(
    service.list({ page: 1, limit: 20, sortBy: 'salary' }, user({ permissions: ['contract.team.read'] })),
    /Unsupported sort field/,
  );
});

test('manager reviews and employee documents reject identity substitution', async () => {
  const manager = user({
    employeeId: 'manager',
    permissions: ['performance.team.manage', 'document.self.manage'],
  });
  const reviews = new PerformanceReviewsService({
    employee: { findFirst: async () => ({ id: 'employee' }) },
  }, audit);
  await assert.rejects(
    reviews.create({
      employeeId: 'direct-report',
      reviewerId: 'victim',
      reviewPeriodStart: new Date('2026-01-01T00:00:00Z'),
      reviewPeriodEnd: new Date('2026-06-30T00:00:00Z'),
      rating: 4,
    }, manager),
    /Managers cannot submit reviews as another employee/,
  );

  const documents = new DocumentsService({
    employee: { findFirst: async () => ({ id: 'manager' }) },
    employeeDocument: {
      findFirst: async () => ({ id: 'document', employeeId: 'manager', uploadedById: 'manager' }),
    },
  }, {}, audit);
  await assert.rejects(
    documents.create({
      employeeId: 'manager',
      documentType: 'ID',
      fileName: 'id.pdf',
      fileUrl: 'https://example.invalid/id.pdf',
      uploadedById: 'victim',
    }, manager),
    /Employees cannot upload documents as another employee/,
  );
  await assert.rejects(
    documents.update('document', { visibility: DocumentVisibility.PUBLIC }, manager),
    /Only HR can publish documents to all employees/,
  );
});

test('attendance dates, lateness, and hours are server-derived', () => {
  const attendance = new AttendanceService({}, audit);
  const data = attendance.manualAttendanceData({
    employeeId: 'employee-1',
    attendanceDate: new Date('2026-07-14T00:00:00Z'),
    checkIn: new Date('2026-07-14T06:30:00Z'),
    checkOut: new Date('2026-07-14T14:30:00Z'),
    status: AttendanceStatus.PRESENT,
    isLate: false,
    lateMinutes: 0,
    workingHours: 99,
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

test('database login throttling survives service recreation and cookies remain hardened', async () => {
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
  const config = {
    get: (key, fallback) => key === 'NODE_ENV' ? 'production' : fallback,
    getOrThrow: () => 'x'.repeat(64),
  };
  const jwt = { decode: () => ({ iat: 1_000, exp: 2_000 }) };
  const authorization = {};
  const auth = new AuthService({}, jwt, config, throttlePrisma, authorization);
  for (let index = 0; index < 20; index += 1) {
    await auth.recordFailedLogin(`ip-${index}`, 'account@example.invalid');
  }
  const restartedAuth = new AuthService({}, jwt, config, throttlePrisma, authorization);
  await assert.rejects(
    restartedAuth.checkLoginLimit('new-ip', 'account@example.invalid'),
    /Too many login attempts/,
  );

  let sessionCookie;
  auth.setSessionCookie({ cookie: (...args) => { sessionCookie = args; } }, 'signed-session');
  assert.equal(sessionCookie[0], '__Host-medtech_hr_session');
  assert.equal(sessionCookie[1], 'signed-session');
  assert.deepEqual(
    { httpOnly: sessionCookie[2].httpOnly, secure: sessionCookie[2].secure, sameSite: sessionCookie[2].sameSite, path: sessionCookie[2].path },
    { httpOnly: true, secure: true, sameSite: 'strict', path: '/' },
  );
  assert.equal(sessionTokenFromRequest({ headers: { cookie: 'other=x; __Host-medtech_hr_session=signed-session' } }), 'signed-session');
  const browser = auth.browserSession({
    user: user(), accessToken: 'secret-token', csrfToken: 'csrf',
  });
  assert.equal('accessToken' in browser, false);
});

test('JWT validation rejects revoked sessions and authorization changes', async () => {
  const token = 'test-token';
  const session = {
    id: 'session-1', userId: 'user-1', tokenHash: createHash('sha256').update(token).digest('hex'),
    authorizationVersion: 3, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, lastSeenAt: new Date(),
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
  session.revokedAt = new Date();
  await assert.rejects(strategy.validate(request, payload), /Session is invalid or expired/);
  session.revokedAt = null;
  session.authorizationVersion = 4;
  await assert.rejects(strategy.validate(request, payload), /Session is invalid or expired/);
  session.authorizationVersion = 3;
  session.expiresAt = new Date(Date.now() - 1);
  await assert.rejects(strategy.validate(request, payload), /Session is invalid or expired/);
});

test('Microsoft identity validation requires HR.User but not a legacy administrator role', () => {
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
  const config = {
    getOrThrow: (key) => {
      if (!values[key]) throw new Error(`Missing ${key}`);
      return values[key];
    },
    get: (key) => values[key],
  };
  const service = new MicrosoftAuthService(config, {}, {});
  const claims = {
    tid: tenantId,
    oid: '33333333-3333-4333-8333-333333333333',
    iss: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    aud: clientId,
    preferred_username: 'employee@example.invalid',
    roles: ['HR.User'],
  };
  assert.deepEqual(service.validateIdentityClaims(claims), {
    objectId: claims.oid,
    email: 'employee@example.invalid',
  });
  assert.throws(() => service.validateIdentityClaims({ ...claims, roles: [] }), /not authorized/);

  const transaction = {
    version: 1,
    state: 'state',
    nonce: 'nonce',
    codeVerifier: 'v'.repeat(64),
    expiresAt: Date.now() + 60_000,
  };
  const encrypted = service.encryptTransaction(transaction);
  assert.deepEqual(service.decryptTransaction(encrypted), transaction);
  const tampered = Buffer.from(encrypted, 'base64url');
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => service.decryptTransaction(tampered.toString('base64url')), /invalid or expired/);
});

test('final active system administrator cannot be disabled and self-role assignment is forbidden', async () => {
  const tx = {
    user: { findFirst: async () => ({ id: 'target', isActive: true, authorizationVersion: 2 }) },
    userRole: { count: async () => 0 },
  };
  const service = new SystemService({ $transaction: async (operation) => operation(tx) });
  await assert.rejects(
    service.changeUserStatus('target', { isActive: false, expectedAuthorizationVersion: 2, reason: 'Security review' }, user()),
    /final active system administrator/,
  );
  assert.throws(
    () => service.assignRoles('user-1', { roleIds: [], expectedAuthorizationVersion: 1, reason: 'Self escalation' }, user()),
    /Self-role assignment/,
  );
});
