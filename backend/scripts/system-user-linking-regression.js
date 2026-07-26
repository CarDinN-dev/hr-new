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
