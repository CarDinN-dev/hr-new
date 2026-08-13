const assert = require('node:assert/strict');
const test = require('node:test');
const { AccessScopeType } = require('@prisma/client');
const { EmployeesService } = require('../dist/modules/employees/employees.service');

const people = [
  { id: 'ceo', firstName: 'Amina', lastName: 'Chief', departmentId: 'executive', managerId: null, lineManagerId: null, position: { title: 'Chief Executive Officer' }, email: 'hidden@example.invalid' },
  { id: 'manager', firstName: 'Mona', lastName: 'Manager', departmentId: 'engineering', managerId: 'ceo', lineManagerId: 'ceo', position: { title: 'Engineering Manager' }, phone: 'hidden' },
  { id: 'employee', firstName: 'Eli', lastName: 'Engineer', departmentId: 'engineering', managerId: 'manager', lineManagerId: 'manager', position: { title: 'Engineer' }, salary: 'hidden' },
  { id: 'finance', firstName: 'Fay', lastName: 'Finance', departmentId: 'finance', managerId: 'ceo', lineManagerId: 'ceo', position: { title: 'Finance Director' } },
];

function requestUser(roles, departmentId = null) {
  return { id: 'user', email: 'user@example.invalid', displayName: 'User', roles, permissions: ['employee.department.read'], rolePermissions: ['employee.department.read'], permissionOverrides: [], isSuperAdmin: false, sessionId: 'session', authProvider: 'local', authorizationVersion: 1, employeeId: 'employee', departmentId, departmentScopeIds: [] };
}

function serviceFor(allowed = () => true) {
  return new EmployeesService({ employee: { findMany: async () => people } }, {}, { permissionAllowedForScope: allowed });
}

test('department Team returns only names and titles plus required reporting ancestors', async () => {
  const checks = [];
  const result = await serviceFor((_, permission, scope, scopeId) => {
    checks.push([permission, scope, scopeId]);
    return true;
  }).teamHierarchy(requestUser(['MANAGER'], 'engineering'));

  assert.deepEqual(result, {
    scope: 'DEPARTMENT',
    roots: [{ id: 'ceo', name: 'Amina Chief', title: 'Chief Executive Officer', children: [{ id: 'manager', name: 'Mona Manager', title: 'Engineering Manager', children: [{ id: 'employee', name: 'Eli Engineer', title: 'Engineer', children: [] }] }] }],
  });
  assert.ok(checks.some(([, scope, scopeId]) => scope === AccessScopeType.DEPARTMENT && scopeId === 'engineering'));
  assert.doesNotMatch(JSON.stringify(result), /email|phone|salary|departmentId/u);
});

test('HR Team receives the full minimal organization hierarchy', async () => {
  const result = await serviceFor().teamHierarchy(requestUser(['HR']));
  assert.equal(result.scope, 'ORGANIZATION');
  assert.deepEqual(result.roots[0].children.map(person => person.id), ['finance', 'manager']);
});
