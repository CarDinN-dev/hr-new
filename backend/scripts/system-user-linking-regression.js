const assert = require('node:assert/strict');
const test = require('node:test');
const { ConfigService } = require('@nestjs/config');
const { EmployeesService } = require('../dist/modules/employees/employees.service');
const { SystemService } = require('../dist/modules/system/system.service');

const actor = {
  id: 'actor-1',
  permissions: ['user.manage'],
  roles: [{ code: 'ADMIN', protection: 'STANDARD' }],
};

function setup({ employee, microsoft = true } = {}) {
  const calls = { provisioning: [], employeeUpdates: [] };
  const account = { id: 'user-1', email: 'employee@example.com', isActive: true, authorizationVersion: 1 };
  const role = { id: 'role-1', code: 'EMPLOYEE', protection: 'STANDARD' };
  const prisma = {
    user: { findUnique: async () => null },
    role: { findMany: async () => [role] },
    employee: { findFirst: async () => employee },
    $transaction: async (operation) => operation({
      role: { findMany: async () => [role] },
      employee: {
        findFirst: async () => employee,
        update: async (args) => { calls.employeeUpdates.push(args); return { id: args.where.id }; },
      },
      user: {
        create: async () => account,
        findUniqueOrThrow: async () => account,
      },
      userRole: { createMany: async () => ({ count: 1 }) },
      notification: { create: async () => ({ id: 'notification-1' }) },
    }),
  };
  const authorization = { permissionAllowedForScope: () => true, require: () => undefined, requireRecentStepUp: () => undefined };
  const audit = { record: async () => undefined };
  const microsoftDirectory = { provisionUser: async (email) => { calls.provisioning.push(email); return { objectId: 'object-1', assignmentCreated: true }; } };
  const service = new SystemService(prisma, audit, authorization, new ConfigService({ BCRYPT_SALT_ROUNDS: 10 }), microsoftDirectory);
  return { service, calls, microsoft };
}

function dto(overrides = {}) {
  return {
    email: ' Employee@EXAMPLE.com ',
    localLoginEnabled: false,
    microsoftLoginEnabled: true,
    roleIds: ['role-1'],
    reason: 'System linking regression',
    ...overrides,
  };
}

test('Microsoft user creation links the case-insensitive employee email before provisioning', async () => {
  const { service, calls } = setup({ employee: { id: 'employee-1', email: 'employee@example.com', userId: null } });
  await service.createUser(dto(), actor);
  assert.deepEqual(calls.provisioning, ['employee@example.com']);
  assert.deepEqual(calls.employeeUpdates, [{ where: { id: 'employee-1' }, data: { userId: 'user-1' } }]);
});

test('Microsoft user creation rejects an unmatched employee before provisioning', async () => {
  const { service, calls } = setup({ employee: null });
  await assert.rejects(() => service.createUser(dto(), actor), (error) => error.getStatus() === 404);
  assert.equal(calls.provisioning.length, 0);
});

test('Microsoft user creation rejects an already linked employee', async () => {
  const { service, calls } = setup({ employee: { id: 'employee-1', email: 'employee@example.com', userId: 'existing-user' } });
  await assert.rejects(() => service.createUser(dto(), actor), (error) => error.getStatus() === 409);
  assert.equal(calls.provisioning.length, 0);
});

test('Microsoft user creation rejects an explicit employee with a different email', async () => {
  const { service, calls } = setup({ employee: { id: 'employee-2', email: 'other@example.com', userId: null } });
  await assert.rejects(() => service.createUser(dto({ employeeId: 'employee-2' }), actor), (error) => error.getStatus() === 400);
  assert.equal(calls.provisioning.length, 0);
});

test('Local-only user creation remains allowed without an employee match', async () => {
  const { service, calls } = setup({ employee: null });
  await service.createUser(dto({ localLoginEnabled: true, microsoftLoginEnabled: false, password: 'LocalAccount123!' }), actor);
  assert.equal(calls.provisioning.length, 0);
  assert.equal(calls.employeeUpdates.length, 0);
});

test('Local user creation links a matching employee email', async () => {
  const { service, calls } = setup({ employee: { id: 'employee-1', email: 'employee@example.com', userId: null } });
  await service.createUser(dto({ localLoginEnabled: true, microsoftLoginEnabled: false, password: 'LocalAccount123!' }), actor);
  assert.deepEqual(calls.employeeUpdates, [{ where: { id: 'employee-1' }, data: { userId: 'user-1' } }]);
});

test('User deletion releases sign-in identifiers and unlinks the employee', async () => {
  const calls = { user: [], employee: [], sessions: [], audit: [] };
  const target = { id: 'user-1', email: 'employee@example.com', authorizationVersion: 2, isActive: true };
  const tx = {
    user: {
      findFirst: async () => target,
      updateMany: async (args) => { calls.user.push(args); return { count: 1 }; },
    },
    userRole: { findFirst: async () => null },
    employee: { updateMany: async (args) => { calls.employee.push(args); return { count: 1 }; } },
    authSession: { updateMany: async (args) => { calls.sessions.push(args); return { count: 1 }; } },
    notification: { create: async () => ({ id: 'notification-1' }) },
  };
  const prisma = { $transaction: async (operation) => operation(tx) };
  const authorization = { permissionAllowedForScope: () => true };
  const audit = { record: async (...args) => { calls.audit.push(args); } };
  const service = new SystemService(prisma, audit, authorization, new ConfigService(), {});

  await service.softDeleteUser('user-1', { expectedVersion: 2, reason: 'Deletion regression' }, { ...actor, permissions: ['user.delete_soft'] });

  assert.deepEqual(calls.user[0].where, { id: 'user-1', authorizationVersion: 2, deletedAt: null });
  assert.deepEqual(calls.user[0].data, {
    email: 'user-1@deleted.invalid', microsoftObjectId: null, passwordHash: null,
    localLoginEnabled: false, microsoftLoginEnabled: false, isActive: false,
    deletedAt: calls.user[0].data.deletedAt, authorizationVersion: { increment: 1 },
  });
  assert.ok(calls.user[0].data.deletedAt instanceof Date);
  assert.deepEqual(calls.employee, [{ where: { userId: 'user-1' }, data: { userId: null } }]);
  assert.equal(calls.sessions.length, 1);
  assert.equal(calls.audit[0][2].before.email, 'employee@example.com');
  assert.equal(calls.audit[0][2].after.emailReleased, true);
});

test('Employee creation links a matching user by normalized email', async () => {
  const calls = [];
  const microsoftUser = { id: 'user-1', employee: null };
  const prisma = {
    department: { findFirst: async () => null },
    jobPosition: { findFirst: async () => null },
    $transaction: async (operation) => operation({
      user: { findFirst: async (args) => {
        assert.equal(args.where.microsoftLoginEnabled, undefined);
        return microsoftUser;
      } },
      employee: { create: async (args) => { calls.push(args); return { id: 'employee-1' }; } },
    }),
  };
  const authorization = { scopeRule: () => ({ unrestricted: true, excludeIds: [], includeIds: [] }), permissionAllowedForScope: () => true };
  const service = new EmployeesService(prisma, { record: async () => undefined }, authorization);

  await service.create({
    employeeCode: 'EMP-0001', firstName: 'Employee', lastName: 'One', email: ' Employee@EXAMPLE.com ',
    hireDate: new Date('2026-01-01T00:00:00.000Z'),
  }, { ...actor, permissions: ['employee.hr.create'] });

  assert.equal(calls[0].data.email, 'employee@example.com');
  assert.equal(calls[0].data.userId, 'user-1');
});

function employeeUpdateService({ userId = null, permissions = ['employee.hr.update', 'user.manage'], linkedUser } = {}) {
  const calls = { employee: [], users: [], roles: [], userRoles: [], sessions: [], notifications: [] };
  const employee = { id: 'employee-1', userId, departmentId: null, positionId: null, email: 'old@med-tech.com' };
  const prisma = {
    employee: { findFirst: async () => employee },
    department: { findFirst: async () => null },
    jobPosition: { findFirst: async () => null },
    $transaction: async (operation) => operation({
      employee: { update: async (args) => { calls.employee.push(args); return { id: args.where.id, ...args.data }; } },
      user: {
        findFirst: async (args) => {
          if (typeof args.where.id === 'string') return linkedUser ?? null;
          if (args.where.email?.equals === 'renamed@med-tech.com' && linkedUser) return null;
          return null;
        },
        create: async (args) => { calls.users.push(args); return { id: 'user-1', email: args.data.email }; },
        update: async (args) => { calls.users.push(args); return { id: args.where.id, ...args.data }; },
      },
      role: { findFirst: async () => ({ id: 'employee-role' }) },
      userRole: { create: async (args) => { calls.userRoles.push(args); return args; } },
      authSession: { updateMany: async (args) => { calls.sessions.push(args); return { count: 1 }; } },
      notification: { create: async (args) => { calls.notifications.push(args); return args; } },
    }),
  };
  const authorization = {
    assertEmployeeScope: async () => undefined,
    has: (_actor, permission) => permissions.includes(permission),
    scopeRule: () => ({ unrestricted: true, excludeIds: [], includeIds: [] }),
    permissionAllowedForScope: () => true,
  };
  return { service: new EmployeesService(prisma, { record: async () => undefined }, authorization), calls, actor: { ...actor, permissions } };
}

test('Corporate employee email creates a linked Microsoft-only Employee account', async () => {
  const { service, calls, actor: updateActor } = employeeUpdateService();

  await service.update('employee-1', { email: ' shipping@med-tech.com ' }, updateActor);

  assert.deepEqual(calls.users, [{ data: { email: 'shipping@med-tech.com', localLoginEnabled: false, microsoftLoginEnabled: true } }]);
  assert.deepEqual(calls.userRoles, [{ data: { userId: 'user-1', roleId: 'employee-role', assignedById: 'actor-1', reason: 'Corporate employee email' } }]);
  assert.deepEqual(calls.employee, [
    { where: { id: 'employee-1' }, data: { userId: 'user-1' } },
    { where: { id: 'employee-1' }, data: { email: 'shipping@med-tech.com', version: { increment: 1 } }, select: calls.employee[1].select },
  ]);
  assert.equal(calls.sessions.length, 0);
  assert.equal(calls.notifications.length, 1);
});

test('Linked employee email changes update the login and revoke sessions', async () => {
  const { service, calls, actor: updateActor } = employeeUpdateService({
    userId: 'user-1', linkedUser: { id: 'user-1', email: 'shipping@med-tech.com', microsoftObjectId: 'directory-id' },
  });

  await service.update('employee-1', { email: 'renamed@med-tech.com' }, updateActor);

  assert.deepEqual(calls.users, [{ where: { id: 'user-1' }, data: { email: 'renamed@med-tech.com', microsoftObjectId: null, authorizationVersion: { increment: 1 } } }]);
  assert.deepEqual(calls.sessions, [{ where: { userId: 'user-1', revokedAt: null }, data: { revokedAt: calls.sessions[0].data.revokedAt } }]);
  assert.ok(calls.sessions[0].data.revokedAt instanceof Date);
  assert.equal(calls.employee.length, 1);
  assert.equal(calls.employee[0].data.email, 'renamed@med-tech.com');
});

test('Employee editors without user management save corporate emails without creating a login', async () => {
  const { service, calls, actor: updateActor } = employeeUpdateService({ permissions: ['employee.hr.update'] });

  await service.update('employee-1', { email: 'shipping@med-tech.com' }, updateActor);

  assert.equal(calls.users.length, 0);
  assert.equal(calls.userRoles.length, 0);
  assert.equal(calls.employee.length, 1);
  assert.equal(calls.employee[0].data.email, 'shipping@med-tech.com');
});
