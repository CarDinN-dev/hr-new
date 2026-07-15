const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const test = require('node:test');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { migrateRbac } = require('../prisma/migrate-rbac');
const { createTestPersonas } = require('../prisma/seed');

const port = Number(process.env.INTEGRATION_PORT || 3901);
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
const password = process.env.TEST_PERSONA_PASSWORD;

function email(role) {
  return `rbac.${role.toLowerCase()}@example.invalid`;
}

async function request(path, options = {}, session) {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (session?.cookie) headers.set('cookie', session.cookie);
  if (session?.csrf && options.csrf !== false) headers.set('x-csrf-token', session.csrf);
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers });
  let payload;
  try { payload = await response.json(); } catch { payload = undefined; }
  return { status: response.status, payload, data: payload?.data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

async function login(role) {
  const result = await request('/auth/login', { method: 'POST', body: JSON.stringify({ email: email(role), password }) });
  assert.equal(result.status, 201, `${role} login failed: ${JSON.stringify(result.payload)}`);
  return { cookie: result.cookie, csrf: result.data.csrfToken, user: result.data.user };
}

async function waitForServer(child) {
  const errors = [];
  child.stderr.on('data', (chunk) => errors.push(String(chunk)));
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Integration server exited early: ${errors.join('')}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Integration server did not become ready: ${errors.join('')}`);
}

function assertNoSensitiveManagerFields(employee) {
  for (const field of ['salary', 'salaryRecords', 'bankAccount', 'dateOfBirth', 'gender', 'address', 'profile', 'benefits', 'credentials', 'education', 'emergencyContactName', 'emergencyContactPhone', 'user']) {
    assert.equal(Object.hasOwn(employee, field), false, `manager projection exposed ${field}`);
  }
}

test('real Nest application enforces the production RBAC matrix', { timeout: 180_000 }, async (t) => {
  assert.equal(process.env.SEED_TEST_PERSONAS, 'true', 'SEED_TEST_PERSONAS=true is required');
  assert.ok(password, 'TEST_PERSONA_PASSWORD is required');
  const prisma = new PrismaClient();
  try {
    const first = await migrateRbac(prisma, { apply: true });
    const second = await migrateRbac(prisma, { apply: true });
    assert.equal(first.invalid.length, 0);
    assert.equal(first.conflicting.length, 0);
    assert.equal(second.created.permissions + second.created.roles + second.created.rolePermissions + second.created.assignments + second.created.users, 0, 'RBAC import must be idempotent');
    await createTestPersonas(prisma, await bcrypt.hash(password, 10));
  } finally {
    await prisma.$disconnect();
  }

  const child = spawn(process.execPath, ['dist/main'], {
    cwd: require('node:path').resolve(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', CORS_ORIGIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGTERM'); });
  await waitForServer(child);

  const sessions = {};
  for (const role of ['EMPLOYEE', 'LINE_MANAGER', 'DEPARTMENT_HEAD', 'HR_OFFICER', 'HR_MANAGER', 'PAYROLL_OFFICER', 'AUDITOR', 'SYSTEM_ADMIN']) {
    sessions[role] = await login(role);
    const me = await request('/auth/me', {}, sessions[role]);
    assert.equal(me.status, 200, `${role} must be able to restore its own session`);
    assert.ok(me.data.user.roles.includes(role));
  }

  assert.equal((await request('/employees/me', {}, sessions.EMPLOYEE)).status, 200);
  assert.equal((await request('/system/users', {}, sessions.EMPLOYEE)).status, 403);
  assert.equal((await request('/payroll', {}, sessions.HR_MANAGER)).status, 403, 'HR_MANAGER must not receive payroll access');
  assert.equal((await request('/employees', {}, sessions.PAYROLL_OFFICER)).status, 403, 'PAYROLL_OFFICER must not receive HR employee access');
  assert.equal((await request('/system/users', {}, sessions.PAYROLL_OFFICER)).status, 403);
  assert.equal((await request('/payroll', {}, sessions.PAYROLL_OFFICER)).status, 200);
  assert.equal((await request('/audit-events', {}, sessions.AUDITOR)).status, 200);
  assert.equal((await request('/system/users', {}, sessions.AUDITOR)).status, 403);
  assert.equal((await request('/system/users', {}, sessions.SYSTEM_ADMIN)).status, 200);
  assert.equal((await request('/payroll', {}, sessions.SYSTEM_ADMIN)).status, 403, 'SYSTEM_ADMIN must not bypass payroll permissions');
  assert.equal((await request('/employees', {}, sessions.SYSTEM_ADMIN)).status, 403, 'SYSTEM_ADMIN must not bypass HR permissions');

  const registeredEmail = `rbac.registered.${Date.now()}@example.invalid`;
  const registeredPassword = 'RegisteredTest123!';
  const registered = await request('/auth/register', {
    method: 'POST', body: JSON.stringify({ email: registeredEmail, password: registeredPassword }),
  }, sessions.SYSTEM_ADMIN);
  assert.equal(registered.status, 201, JSON.stringify(registered.payload));
  assert.equal(Object.hasOwn(registered.data, 'passwordHash'), false);
  const registeredLogin = await request('/auth/login', {
    method: 'POST', body: JSON.stringify({ email: registeredEmail, password: registeredPassword }),
  });
  assert.equal(registeredLogin.status, 201);
  const registeredSession = { cookie: registeredLogin.cookie, csrf: registeredLogin.data.csrfToken };
  const registeredMe = await request('/auth/me', {}, registeredSession);
  assert.equal(registeredMe.status, 200);
  assert.deepEqual(registeredMe.data.user.roles, ['EMPLOYEE']);

  const managerEmployees = await request('/employees?limit=100', {}, sessions.LINE_MANAGER);
  assert.equal(managerEmployees.status, 200);
  for (const employee of managerEmployees.data) assertNoSensitiveManagerFields(employee);
  const departmentEmployees = await request('/employees?limit=100', {}, sessions.DEPARTMENT_HEAD);
  for (const employee of departmentEmployees.data) assertNoSensitiveManagerFields(employee);

  const hrEmployees = await request('/employees?limit=100', {}, sessions.HR_MANAGER);
  assert.equal(hrEmployees.status, 200);
  for (const employee of hrEmployees.data) {
    assert.equal(Object.hasOwn(employee, 'salary'), false, 'HR_MANAGER must not load salary');
    assert.equal(Object.hasOwn(employee, 'bankAccount'), false, 'HR_MANAGER must not load bank details');
  }
  const hrOfficerEmployees = await request('/employees?limit=100', {}, sessions.HR_OFFICER);
  assert.equal(hrOfficerEmployees.status, 200);
  const operationallySensitiveFields = ['dateOfBirth', 'gender', 'address', 'emergencyContactName', 'emergencyContactPhone', 'profile', 'benefits', 'credentials', 'education', 'user'];
  for (const employee of hrOfficerEmployees.data) {
    for (const field of operationallySensitiveFields) assert.equal(Object.hasOwn(employee, field), false, `HR_OFFICER projection exposed ${field}`);
  }
  const auditorEmployees = await request('/employees?limit=100', {}, sessions.AUDITOR);
  assert.equal(auditorEmployees.status, 200);
  for (const employee of auditorEmployees.data) assertNoSensitiveManagerFields(employee);
  const employeeId = sessions.EMPLOYEE.user.employeeId;
  const hrManagerId = sessions.HR_MANAGER.user.employeeId;
  assert.equal((await request(`/employees/${hrManagerId}`, {}, sessions.EMPLOYEE)).status, 404, 'employee ID substitution must not cross scope');
  const substitutedLoans = await request(`/loans?employeeId=${hrManagerId}`, {}, sessions.EMPLOYEE);
  assert.equal(substitutedLoans.status, 200);
  assert.deepEqual(substitutedLoans.data, []);

  const noCsrf = await request('/auth/logout', { method: 'POST', csrf: false }, sessions.EMPLOYEE);
  assert.equal(noCsrf.status, 403, 'unsafe request without CSRF must fail');
  assert.equal((await request('/auth/me', {}, sessions.EMPLOYEE)).status, 200);

  const leaveTypes = await request('/leave/types?limit=100', {}, sessions.HR_OFFICER);
  assert.equal(leaveTypes.status, 200);
  assert.ok(leaveTypes.data.length, 'at least one leave type is required for the integration workflow');
  const leaveTypeId = leaveTypes.data[0].id;
  for (const targetEmployeeId of [employeeId, hrManagerId]) {
    const balance = await request('/leave/balances', {
      method: 'POST', body: JSON.stringify({ employeeId: targetEmployeeId, leaveTypeId, year: 2099, totalDays: 20 }),
    }, sessions.HR_OFFICER);
    assert.ok([200, 201].includes(balance.status), JSON.stringify(balance.payload));
  }
  const createdLeave = await request('/leave/requests', {
    method: 'POST', body: JSON.stringify({ leaveTypeId, startDate: '2099-04-10', endDate: '2099-04-11', reason: 'RBAC integration test' }),
  }, sessions.EMPLOYEE);
  assert.equal(createdLeave.status, 201);
  assert.equal(createdLeave.data.status, 'PENDING_MANAGER');
  const managerDecision = await request(`/leave/requests/${createdLeave.data.id}/decision`, {
    method: 'POST', body: JSON.stringify({ status: 'APPROVED' }),
  }, sessions.LINE_MANAGER);
  assert.equal(managerDecision.status, 201);
  assert.equal(managerDecision.data.status, 'PENDING_HR');
  const hrDecision = await request(`/leave/requests/${createdLeave.data.id}/decision`, {
    method: 'POST', body: JSON.stringify({ status: 'APPROVED' }),
  }, sessions.HR_MANAGER);
  assert.equal(hrDecision.status, 201);
  assert.equal(hrDecision.data.status, 'APPROVED');

  const ownHrLeave = await request('/leave/requests', {
    method: 'POST', body: JSON.stringify({ employeeId: hrManagerId, leaveTypeId, startDate: '2099-05-10', endDate: '2099-05-10', reason: 'Self approval test' }),
  }, sessions.HR_MANAGER);
  assert.equal(ownHrLeave.status, 201);
  assert.equal(ownHrLeave.data.status, 'PENDING_HR');
  assert.equal((await request(`/leave/requests/${ownHrLeave.data.id}/decision`, {
    method: 'POST', body: JSON.stringify({ status: 'APPROVED' }),
  }, sessions.HR_MANAGER)).status, 403, 'self approval must fail regardless of role union');

  const systemUsers = await request('/system/users?limit=100', {}, sessions.SYSTEM_ADMIN);
  const auditor = systemUsers.data.find((item) => item.email === email('AUDITOR'));
  const hrOfficer = systemUsers.data.find((item) => item.email === email('HR_OFFICER'));
  const systemAdmin = systemUsers.data.find((item) => item.email === email('SYSTEM_ADMIN'));
  const systemRoles = await request('/system/roles?limit=100', {}, sessions.SYSTEM_ADMIN);
  const auditorRole = systemRoles.data.find((item) => item.code === 'AUDITOR');
  assert.equal((await request(`/system/users/${systemAdmin.id}/roles`, {
    method: 'PUT', body: JSON.stringify({ roleIds: systemAdmin.roles.map((item) => item.role.id), expectedAuthorizationVersion: systemAdmin.authorizationVersion, reason: 'Direct self-role bypass test' }),
  }, sessions.SYSTEM_ADMIN)).status, 403, 'self-role assignment must fail through the real API');
  assert.equal((await request(`/system/users/${systemAdmin.id}/status`, {
    method: 'PATCH', body: JSON.stringify({ isActive: false, expectedAuthorizationVersion: systemAdmin.authorizationVersion, reason: 'Direct final-admin bypass test' }),
  }, sessions.SYSTEM_ADMIN)).status, 403, 'self-disable must not bypass final-administrator protection');
  const catalogue = await request('/system/permissions?limit=100', {}, sessions.SYSTEM_ADMIN);
  const announcementRead = catalogue.data.find((item) => item.code === 'announcement.read');
  const departmentRead = catalogue.data.find((item) => item.code === 'department.read');
  const roleCode = `RBAC_TEST_${Date.now()}`;
  const customRole = await request('/system/roles', {
    method: 'POST', body: JSON.stringify({ code: roleCode, displayName: 'RBAC integration role', permissionIds: [announcementRead.id], reason: 'Integration role test' }),
  }, sessions.SYSTEM_ADMIN);
  assert.equal(customRole.status, 201);
  const assignment = await request(`/system/users/${auditor.id}/roles`, {
    method: 'PUT', body: JSON.stringify({ roleIds: [auditorRole.id, customRole.data.id], expectedAuthorizationVersion: auditor.authorizationVersion, reason: 'Integration assignment test' }),
  }, sessions.SYSTEM_ADMIN);
  assert.equal(assignment.status, 200);
  assert.equal((await request('/auth/me', {}, sessions.AUDITOR)).status, 401, 'role assignment must revoke existing sessions');
  const auditorAfterAssignment = await login('AUDITOR');
  const permissionChange = await request(`/system/roles/${customRole.data.id}/permissions`, {
    method: 'PUT', body: JSON.stringify({ permissionIds: [announcementRead.id, departmentRead.id], expectedVersion: customRole.data.version, reason: 'Integration permission invalidation test' }),
  }, sessions.SYSTEM_ADMIN);
  assert.equal(permissionChange.status, 200);
  assert.equal((await request('/auth/me', {}, auditorAfterAssignment)).status, 401, 'role permission changes must revoke affected sessions');

  const disable = await request(`/system/users/${hrOfficer.id}/status`, {
    method: 'PATCH', body: JSON.stringify({ isActive: false, expectedAuthorizationVersion: hrOfficer.authorizationVersion, reason: 'Integration disable test' }),
  }, sessions.SYSTEM_ADMIN);
  assert.equal(disable.status, 200);
  assert.equal((await request('/auth/me', {}, sessions.HR_OFFICER)).status, 401, 'disabled account session must fail');
  const enable = await request(`/system/users/${hrOfficer.id}/status`, {
    method: 'PATCH', body: JSON.stringify({ isActive: true, expectedAuthorizationVersion: disable.data.authorizationVersion, reason: 'Integration restore test' }),
  }, sessions.SYSTEM_ADMIN);
  assert.equal(enable.status, 200);

  const administrativelyRevoked = await login('EMPLOYEE');
  assert.equal((await request(`/system/sessions/${administrativelyRevoked.user.sessionId}/revoke`, {
    method: 'POST', body: JSON.stringify({ reason: 'Integration administrative revocation test' }),
  }, sessions.SYSTEM_ADMIN)).status, 201);
  assert.equal((await request('/auth/me', {}, administrativelyRevoked)).status, 401, 'administratively revoked session must fail');

  const expired = await login('EMPLOYEE');
  const expiryPrisma = new PrismaClient();
  try {
    await expiryPrisma.authSession.update({ where: { id: expired.user.sessionId }, data: { expiresAt: new Date(0) } });
  } finally {
    await expiryPrisma.$disconnect();
  }
  assert.equal((await request('/auth/me', {}, expired)).status, 401, 'expired database session must fail');

  const employeeSecond = await login('EMPLOYEE');
  assert.equal((await request('/auth/logout', { method: 'POST' }, sessions.EMPLOYEE)).status, 200);
  assert.equal((await request('/auth/me', {}, sessions.EMPLOYEE)).status, 401);
  assert.equal((await request('/auth/me', {}, employeeSecond)).status, 200, 'current logout must not revoke another session');
  assert.equal((await request('/auth/logout-all', { method: 'POST' }, employeeSecond)).status, 200);
  assert.equal((await request('/auth/me', {}, employeeSecond)).status, 401);
});
