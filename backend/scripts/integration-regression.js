const assert = require('node:assert/strict');
const { execFileSync, spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdir, rm } = require('node:fs/promises');
const path = require('node:path');
const test = require('node:test');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');
const { syncRbac } = require('../prisma/sync-rbac');
const { createTestPersonas, seedReferenceData } = require('../prisma/seed');

const backendDirectory = path.resolve(__dirname, '..');
const port = Number(process.env.INTEGRATION_PORT || 3901);
const baseUrl = `http://127.0.0.1:${port}/api/v1`;
const password = process.env.TEST_PERSONA_PASSWORD || 'IntegrationPass123!';
const checkerPassword = 'CheckerPass123!';
const blockedPassword = 'BlockedPass123!';
const roles = ['EMPLOYEE', 'LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO', 'ADMIN', 'SUPER_ADMIN'];

function personaEmail(role) {
  return `rbac.${role.toLowerCase()}@example.invalid`;
}

function idempotency(prefix) {
  return `${prefix}:${randomUUID()}`;
}

function databaseUrls() {
  const source = process.env.INTEGRATION_DATABASE_URL;
  assert.ok(source, 'INTEGRATION_DATABASE_URL is required and must point to a disposable PostgreSQL database');
  const parsed = new URL(source);
  if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname) && process.env.ALLOW_REMOTE_INTEGRATION_DB !== 'true') {
    throw new Error('Remote integration databases require ALLOW_REMOTE_INTEGRATION_DB=true');
  }
  const schema = `rbac_it_${process.pid}_${Date.now()}`.toLowerCase();
  const admin = new URL(parsed);
  admin.searchParams.set('schema', 'public');
  const isolated = new URL(parsed);
  isolated.searchParams.set('schema', schema);
  return { schema, adminUrl: admin.toString(), databaseUrl: isolated.toString() };
}

async function api(pathname, options = {}, session) {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (body !== undefined && !(body instanceof FormData) && typeof body !== 'string') {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  if (session?.cookie) headers.set('cookie', session.cookie);
  if (session?.csrf && options.csrf !== false) headers.set('x-csrf-token', session.csrf);
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, body, headers });
  const contentType = response.headers.get('content-type') || '';
  let payload;
  let buffer;
  if (contentType.includes('application/json')) payload = await response.json();
  else buffer = Buffer.from(await response.arrayBuffer());
  return {
    status: response.status,
    payload,
    data: payload?.data,
    meta: payload?.meta,
    buffer,
    contentType,
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  };
}

async function login(email, loginPassword = password) {
  const result = await api('/auth/login', { method: 'POST', body: { email, password: loginPassword } });
  assert.equal(result.status, 201, `Login failed for ${email}: ${JSON.stringify(result.payload)}`);
  return { cookie: result.cookie, csrf: result.data.csrfToken, user: result.data.user };
}

async function loginRole(role) {
  return login(personaEmail(role));
}

async function mutate(pathname, session, body, key = idempotency('mutation'), method = 'POST') {
  return api(pathname, { method, body, headers: { 'idempotency-key': key } }, session);
}

async function waitForServer(child, output) {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Integration server exited early:\n${output.join('').slice(-20_000)}`);
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Integration server did not become ready:\n${output.join('').slice(-20_000)}`);
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function assertManagerProjection(employee) {
  for (const field of [
    'salary', 'salaryRecords', 'bankAccount', 'dateOfBirth', 'gender', 'address', 'profile', 'benefits',
    'credentials', 'education', 'emergencyContactName', 'emergencyContactPhone', 'user', 'documents', 'sessions',
  ]) assert.equal(Object.hasOwn(employee, field), false, `manager projection exposed ${field}`);
}

test('real Nest application enforces production RBAC and workflow invariants', { timeout: 360_000 }, async (t) => {
  const { schema, adminUrl, databaseUrl } = databaseUrls();
  const storageDirectory = path.resolve(backendDirectory, `.integration-storage-${schema}`);
  const adminPrisma = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let prisma;
  let child;
  const serverOutput = [];

  t.after(async () => {
    await stopServer(child);
    await prisma?.$disconnect();
    await adminPrisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
    await adminPrisma.$disconnect();
    await rm(storageDirectory, { recursive: true, force: true });
  });

  await adminPrisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  const prismaCli = path.resolve(backendDirectory, 'node_modules/prisma/build/index.js');
  const migrationEnvironment = { ...process.env, DATABASE_URL: databaseUrl };
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: backendDirectory, env: migrationEnvironment, stdio: 'pipe' });
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], { cwd: backendDirectory, env: migrationEnvironment, stdio: 'pipe' });

  prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const firstSync = await syncRbac(prisma);
  const secondSync = await syncRbac(prisma);
  assert.ok(firstSync.permissionsCreated > 0 && firstSync.rolesCreated === 8);
  assert.deepEqual(secondSync, { permissionsCreated: 0, rolesCreated: 0, rolePermissionsCreated: 0, rolePermissionsRemoved: 0 });
  await seedReferenceData(prisma);
  const previousSeedFlag = process.env.SEED_TEST_PERSONAS;
  process.env.SEED_TEST_PERSONAS = 'true';
  await createTestPersonas(prisma, await bcrypt.hash(password, 10));
  process.env.SEED_TEST_PERSONAS = previousSeedFlag;

  const employeeRole = await prisma.role.findUniqueOrThrow({ where: { code: 'EMPLOYEE' } });
  const testDepartment = await prisma.department.findUniqueOrThrow({ where: { code: 'RBAC_TEST' } });
  const blockedUser = await prisma.user.create({
    data: {
      email: 'rbac.blocked@example.invalid', passwordHash: await bcrypt.hash(blockedPassword, 10),
      isActive: true, localLoginEnabled: true,
      roles: { create: { roleId: employeeRole.id, reason: 'Missing-approver integration persona' } },
      employee: {
        create: {
          employeeCode: 'RBAC-BLOCKED', firstName: 'Blocked', lastName: 'Persona', email: 'rbac.blocked@example.invalid',
          hireDate: new Date('2026-01-01T00:00:00.000Z'), salary: '10000.00', departmentId: testDepartment.id,
        },
      },
    },
    include: { employee: true },
  });

  await mkdir(storageDirectory, { recursive: true });
  const serverEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: String(port),
    NODE_ENV: 'test',
    CORS_ORIGIN: '',
    JWT_SECRET: 'integration-jwt-secret-'.padEnd(64, 'x'),
    AUDIT_HMAC_KEY: 'integration-audit-secret-'.padEnd(64, 'y'),
    JWT_EXPIRES_IN: '2h',
    BCRYPT_SALT_ROUNDS: '10',
    DOCUMENT_STORAGE_ADAPTER: 'filesystem-test',
    TEST_STORAGE_DIRECTORY: storageDirectory,
    GCS_DOCUMENTS_BUCKET: '',
    MICROSOFT_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    MICROSOFT_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    MICROSOFT_CLIENT_SECRET: 'integration-client-secret-value',
    MICROSOFT_REDIRECT_URI: `http://127.0.0.1:${port}/api/v1/auth/microsoft/callback`,
    MICROSOFT_PROVISIONING_ENABLED: 'false',
  };
  child = spawn(process.execPath, ['dist/main'], { cwd: backendDirectory, env: serverEnvironment, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => serverOutput.push(String(chunk)));
  child.stderr.on('data', (chunk) => serverOutput.push(String(chunk)));
  await waitForServer(child, serverOutput);

  const sessions = {};
  for (const role of roles) {
    sessions[role] = await loginRole(role);
    const restored = await api('/auth/me', {}, sessions[role]);
    assert.equal(restored.status, 200);
    assert.equal(restored.data.user.roles.includes(role), true);
    assert.equal(Object.hasOwn(restored.data.user, 'passwordHash'), false);
  }
  const blocked = await login('rbac.blocked@example.invalid', blockedPassword);

  assert.equal((await api('/employees/me', {}, sessions.EMPLOYEE)).status, 200);
  assert.equal((await api('/system/users', {}, sessions.EMPLOYEE)).status, 403);
  assert.equal((await api('/system/users', {}, sessions.HR)).status, 403);
  assert.equal((await api('/system/users?limit=100', {}, sessions.SUPER_ADMIN)).status, 200);
  for (const role of ['CPO', 'COO', 'ADMIN']) {
    assert.equal((await api('/payroll/runs', {}, sessions[role])).status, 200);
    assert.equal((await mutate('/payroll/runs', sessions[role], { year: 2098, month: 6 })).status, 403);
  }

  const managerEmployees = await api('/employees?limit=100', {}, sessions.LINE_MANAGER);
  assert.equal(managerEmployees.status, 200);
  managerEmployees.data.forEach(assertManagerProjection);
  const managementEmployees = await api('/employees?limit=100', {}, sessions.MANAGER);
  assert.equal(managementEmployees.status, 200);
  managementEmployees.data.forEach(assertManagerProjection);
  assert.equal((await api(`/employees/${sessions.HR.user.employeeId}`, {}, sessions.EMPLOYEE)).status, 404);
  assert.equal((await api(`/employees/${sessions.EMPLOYEE.user.employeeId}`, { method: 'PUT', body: {} }, sessions.HR)).status, 404);
  assert.equal((await api('/employees', {
    method: 'POST', body: {
      employeeCode: 'MASS-ASSIGN', firstName: 'Mass', lastName: 'Assign', email: 'mass@example.invalid',
      hireDate: '2026-01-01', roles: ['SUPER_ADMIN'],
    },
  }, sessions.HR)).status, 400);

  const missingCsrf = await api('/auth/logout', { method: 'POST', csrf: false }, sessions.EMPLOYEE);
  assert.equal(missingCsrf.status, 403);
  assert.equal((await api('/auth/me', {}, sessions.EMPLOYEE)).status, 200);

  const systemAdmin = sessions.SUPER_ADMIN;
  const systemRoles = (await api('/system/roles', {}, systemAdmin)).data;
  const hrRole = systemRoles.find((role) => role.code === 'HR');
  const lineManagerRole = systemRoles.find((role) => role.code === 'LINE_MANAGER');
  const adminRole = systemRoles.find((role) => role.code === 'ADMIN');
  const superAdminRole = systemRoles.find((role) => role.code === 'SUPER_ADMIN');
  await prisma.authSession.update({ where: { id: systemAdmin.user.sessionId }, data: { reauthenticatedAt: new Date(0) } });
  const protectedAccountCreated = await api('/system/users', {
    method: 'POST', body: {
      email: `system.protected.${Date.now()}@example.invalid`, password: checkerPassword, localLoginEnabled: true, microsoftLoginEnabled: false,
      roleIds: [adminRole.id, superAdminRole.id], reason: 'Protected account creation without step-up integration test',
    },
  }, systemAdmin);
  assert.equal(protectedAccountCreated.status, 201, JSON.stringify(protectedAccountCreated.payload));
  const checkerCreated = await api('/system/users', {
    method: 'POST',
    body: {
      email: 'rbac.checker@example.invalid', password: checkerPassword, localLoginEnabled: true, microsoftLoginEnabled: false,
      roleIds: [hrRole.id, lineManagerRole.id], reason: 'Maker-checker integration account',
    },
  }, systemAdmin);
  assert.equal(checkerCreated.status, 201, JSON.stringify(checkerCreated.payload));
  assert.equal(Object.hasOwn(checkerCreated.data, 'passwordHash'), false);
  const checker = await login('rbac.checker@example.invalid', checkerPassword);
  assert.deepEqual(checker.user.roles.sort(), ['HR', 'LINE_MANAGER']);

  const leaveTypes = await api('/leave/types?limit=100', {}, sessions.HR);
  assert.equal(leaveTypes.status, 200);
  const annualLeave = leaveTypes.data.find((type) => type.code === 'ANNUAL');
  for (const employeeId of [sessions.EMPLOYEE.user.employeeId, sessions.COO.user.employeeId, blockedUser.employee.id]) {
    const balance = await api('/leave/balances', {
      method: 'POST', body: { employeeId, leaveTypeId: annualLeave.id, year: 2099, totalDays: 30 },
    }, sessions.HR);
    assert.equal(balance.status, 201, JSON.stringify(balance.payload));
  }

  const submitKey = idempotency('leave-submit');
  const leaveBody = { leaveTypeId: annualLeave.id, startDate: '2099-04-10', endDate: '2099-04-11', reason: 'Integration workflow' };
  const submitted = await mutate('/leave/submit', sessions.EMPLOYEE, leaveBody, submitKey);
  assert.equal(submitted.status, 201);
  assert.equal(submitted.data.status, 'PENDING_LINE_MANAGER');
  const duplicateSubmit = await mutate('/leave/submit', sessions.EMPLOYEE, leaveBody, submitKey);
  assert.equal(duplicateSubmit.status, 201);
  assert.equal(duplicateSubmit.data.id, submitted.data.id);
  assert.equal((await mutate(`/leave/${submitted.data.id}/approve`, sessions.EMPLOYEE, { expectedVersion: submitted.data.version })).status, 403);

  const managerInbox = await api('/approvals/inbox', {}, sessions.LINE_MANAGER);
  assert.equal(managerInbox.status, 200);
  assert.equal(managerInbox.data.leave.some((request) => request.id === submitted.data.id), true);
  const competing = await Promise.all([
    mutate(`/leave/${submitted.data.id}/approve`, sessions.LINE_MANAGER, { expectedVersion: submitted.data.version, reason: 'Approved' }, idempotency('line-a')),
    mutate(`/leave/${submitted.data.id}/approve`, sessions.LINE_MANAGER, { expectedVersion: submitted.data.version, reason: 'Approved' }, idempotency('line-b')),
  ]);
  assert.equal(competing.filter((result) => result.status === 201).length, 1);
  assert.equal(competing.some((result) => [400, 409].includes(result.status)), true);
  let leave = competing.find((result) => result.status === 201).data;
  assert.equal(leave.status, 'PENDING_MANAGER');
  for (const [role, expected] of [['MANAGER', 'PENDING_HR'], ['HR', 'PENDING_CPO'], ['CPO', 'PENDING_COO'], ['COO', 'APPROVED']]) {
    const result = await mutate(`/leave/${leave.id}/approve`, sessions[role], { expectedVersion: leave.version, reason: `${role} approval` });
    assert.equal(result.status, 201, JSON.stringify(result.payload));
    leave = result.data;
    assert.equal(leave.status, expected);
  }
  const hrIdentity = await api('/auth/me', {}, sessions.HR);
  assert.equal(hrIdentity.data.user.permissions.includes('leave.hr.read'), true, JSON.stringify(hrIdentity.data.user.permissions));
  const balanceAfterApproval = await api(`/leave/balances?employeeId=${sessions.EMPLOYEE.user.employeeId}&year=2099`, {}, sessions.HR);
  assert.equal(balanceAfterApproval.status, 200, JSON.stringify(balanceAfterApproval.payload));
  const balanceRecord = balanceAfterApproval.data.find((record) => record.leaveTypeId === annualLeave.id);
  assert.ok(balanceRecord, `Approved balance missing from API response: ${JSON.stringify(balanceAfterApproval.payload)}`);
  assert.equal(String(balanceRecord.usedDays), '2');
  assert.equal(String(balanceRecord.pendingDays), '0');

  const cooLeave = await mutate('/leave/submit', sessions.COO, {
    leaveTypeId: annualLeave.id, startDate: '2099-05-10', endDate: '2099-05-10', reason: 'Protected self approval',
  });
  assert.equal(cooLeave.status, 201);
  assert.equal(cooLeave.data.status, 'PENDING_COO');
  assert.equal((await mutate(`/leave/${cooLeave.data.id}/approve`, sessions.COO, { expectedVersion: cooLeave.data.version })).status, 403);
  await prisma.authSession.update({ where: { id: sessions.COO.user.sessionId }, data: { reauthenticatedAt: new Date(0) } });
  assert.equal((await mutate(`/leave/${cooLeave.data.id}/self-approve`, sessions.COO, { expectedVersion: cooLeave.data.version }, idempotency('stale-step-up'))).status, 403);
  assert.equal((await api('/auth/step-up/local', { method: 'POST', body: { password } }, sessions.COO)).status, 200);
  const selfApproved = await mutate(`/leave/${cooLeave.data.id}/self-approve`, sessions.COO, { expectedVersion: cooLeave.data.version, reason: 'COO protected self approval' });
  assert.equal(selfApproved.status, 201);
  assert.equal(selfApproved.data.status, 'APPROVED');

  const blockedLeave = await mutate('/leave/submit', blocked, {
    leaveTypeId: annualLeave.id, startDate: '2099-06-10', endDate: '2099-06-10', reason: 'Missing approver test',
  });
  assert.equal(blockedLeave.status, 201);
  assert.equal(blockedLeave.data.status, 'BLOCKED_APPROVER_MISSING');

  const certificate = await mutate('/service-requests', sessions.EMPLOYEE, {
    requestType: 'SALARY_CERTIFICATE', requesterComment: 'Employment confirmation',
  });
  assert.equal(certificate.status, 201);
  assert.equal((await api(`/service-requests/${certificate.data.id}/download`, {}, sessions.EMPLOYEE)).status, 404);
  let serviceRequest = certificate.data;
  for (const [action, expected] of [['review', 'IN_HR_REVIEW'], ['generate', 'GENERATED'], ['submit-approval', 'PENDING_HR_APPROVAL']]) {
    const result = await mutate(`/service-requests/${serviceRequest.id}/${action}`, sessions.HR, { expectedVersion: serviceRequest.version, reason: `${action} integration` });
    assert.equal(result.status, 201, JSON.stringify(result.payload));
    serviceRequest = result.data;
    assert.equal(serviceRequest.status, expected);
    assert.doesNotMatch(JSON.stringify(serviceRequest), /objectName|objectGeneration/);
  }
  assert.equal((await mutate(`/service-requests/${serviceRequest.id}/approve`, sessions.HR, { expectedVersion: serviceRequest.version })).status, 403);
  const certificateApproved = await mutate(`/service-requests/${serviceRequest.id}/approve`, checker, { expectedVersion: serviceRequest.version, reason: 'Independent HR approval' });
  assert.equal(certificateApproved.status, 201);
  serviceRequest = certificateApproved.data;
  const certificatePublished = await mutate(`/service-requests/${serviceRequest.id}/publish`, sessions.HR, { expectedVersion: serviceRequest.version, reason: 'Publish approved certificate' });
  assert.equal(certificatePublished.status, 201);
  const certificateDownload = await api(`/service-requests/${serviceRequest.id}/download`, {}, sessions.EMPLOYEE);
  assert.equal(certificateDownload.status, 200);
  assert.equal(certificateDownload.contentType.includes('application/pdf'), true);
  assert.equal(certificateDownload.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal((await mutate(`/service-requests/${serviceRequest.id}/generate`, sessions.HR, { expectedVersion: certificatePublished.data.version })).status, 400);
  assert.equal(await prisma.generatedDocumentVersion.count({ where: { requestId: serviceRequest.id } }), 1);
  assert.equal((await mutate(`/service-requests/${serviceRequest.id}/approve`, sessions.ADMIN, { expectedVersion: certificatePublished.data.version })).status, 403);

  const documentBody = new FormData();
  documentBody.set('employeeId', sessions.EMPLOYEE.user.employeeId);
  documentBody.set('documentType', 'Identity document');
  documentBody.set('visibility', 'EMPLOYEE_ONLY');
  documentBody.set('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }), 'identity.pdf');
  const uploadedDocument = await api('/documents/upload', { method: 'POST', body: documentBody }, sessions.EMPLOYEE);
  assert.equal(uploadedDocument.status, 201, JSON.stringify(uploadedDocument.payload));
  assert.doesNotMatch(JSON.stringify(uploadedDocument.data), /objectName|objectGeneration/);
  assert.equal((await api(`/documents/${uploadedDocument.data.id}/content`, {}, sessions.EMPLOYEE)).status, 200);

  const absent = await api('/attendance', { method: 'POST', body: { employeeId: sessions.EMPLOYEE.user.employeeId, attendanceDate: '2098-06-02', status: 'ABSENT' } }, sessions.HR);
  const halfDay = await api('/attendance', { method: 'POST', body: { employeeId: sessions.EMPLOYEE.user.employeeId, attendanceDate: '2098-06-03', status: 'HALF_DAY' } }, sessions.HR);
  assert.equal(absent.status, 201); assert.equal(halfDay.status, 201);
  const loan = await api('/loans', {
    method: 'POST', body: {
      employeeId: sessions.EMPLOYEE.user.employeeId, type: 'Salary advance', principal: '1200.00', disbursementDate: '2098-05-01',
      startYear: 2098, startMonth: 6, repaymentMode: 'DURATION', termMonths: 12, monthlyLimit: '0',
    },
  }, sessions.HR);
  assert.equal(loan.status, 201);
  assert.equal((await api(`/loans/${loan.data.id}/activate`, { method: 'PATCH' }, sessions.HR)).status, 200);

  let payroll = await mutate('/payroll/runs', sessions.HR, { year: 2098, month: 6, employeeId: sessions.EMPLOYEE.user.employeeId });
  assert.equal(payroll.status, 201, JSON.stringify(payroll.payload));
  assert.equal(String(payroll.data.payrolls[0].grossPay), '10000');
  assert.equal(String(payroll.data.payrolls[0].deductions), '600');
  assert.equal(String(payroll.data.payrolls[0].netPay), '9400');
  const unpublishedPayslips = await api('/payroll/payslips/me?year=2098&month=6', {}, sessions.EMPLOYEE);
  assert.equal(unpublishedPayslips.status, 200, JSON.stringify(unpublishedPayslips.payload));
  assert.equal(unpublishedPayslips.data.length, 0);
  payroll = await mutate(`/payroll/runs/${payroll.data.id}/submit`, sessions.HR, { expectedVersion: payroll.data.version, reason: 'Submit payroll' });
  assert.equal(payroll.status, 201);
  assert.equal((await mutate(`/payroll/runs/${payroll.data.id}/approve`, sessions.HR, { expectedVersion: payroll.data.version })).status, 403);
  payroll = await mutate(`/payroll/runs/${payroll.data.id}/approve`, checker, { expectedVersion: payroll.data.version, reason: 'Independent payroll approval' });
  assert.equal(payroll.status, 201);
  payroll = await mutate(`/payroll/runs/${payroll.data.id}/publish`, sessions.HR, { expectedVersion: payroll.data.version, reason: 'Publish payroll' });
  assert.equal(payroll.status, 201);
  assert.equal(payroll.data.status, 'PUBLISHED');
  assert.doesNotMatch(JSON.stringify(payroll.data), /objectName|objectGeneration|sha256/);
  const myPayslips = await api('/payroll/payslips/me?year=2098&month=6', {}, sessions.EMPLOYEE);
  assert.equal(myPayslips.status, 200);
  assert.equal(myPayslips.data.length, 1);
  const payslipDownload = await api(`/payroll/payslips/${myPayslips.data[0].id}/download`, {}, sessions.EMPLOYEE);
  assert.equal(payslipDownload.status, 200);
  assert.equal(payslipDownload.buffer.subarray(0, 4).toString(), '%PDF');
  assert.equal((await api('/attendance/reports/summary?dateFrom=2098-06-01&dateTo=2098-06-30', {}, sessions.CPO)).status, 200);
  assert.ok([400, 409].includes((await api(`/attendance/${absent.data.id}`, { method: 'PATCH', body: { status: 'PRESENT', correctionReason: 'Historical mutation attempt' } }, sessions.HR)).status));
  const departments = await api('/payroll/departments', {}, sessions.HR);
  const exportDepartment = departments.data.find((department) => department.id === testDepartment.id);
  const departmentExport = await api(`/payroll/runs/${payroll.data.id}/export?departmentId=${exportDepartment.id}`, {}, sessions.HR);
  assert.equal(departmentExport.status, 200);
  assert.match(departmentExport.buffer.toString('utf8'), /RBAC-EMPLOYEE/);

  const departmentA = await api('/departments', { method: 'POST', body: { name: 'Scoped A', code: `SCA${Date.now()}`.slice(0, 20) } }, sessions.ADMIN);
  const departmentB = await api('/departments', { method: 'POST', body: { name: 'Scoped B', code: `SCB${Date.now()}`.slice(0, 20) } }, sessions.ADMIN);
  assert.equal(departmentA.status, 201); assert.equal(departmentB.status, 201);
  const permissionCatalogueResponse = await api('/system/permissions', {}, systemAdmin);
  assert.equal(permissionCatalogueResponse.status, 200);
  assert.equal((await api('/system/permissions?page=1', {}, systemAdmin)).status, 400);
  assert.equal((await api('/system/permissions?limit=100', {}, systemAdmin)).status, 400);
  const permissionCatalogue = permissionCatalogueResponse.data;
  const departmentRead = permissionCatalogue.find((permission) => permission.code === 'department.read');
  const announcementRead = permissionCatalogue.find((permission) => permission.code === 'announcement.read');
  let systemUsers = (await api('/system/users?limit=100', {}, systemAdmin)).data;
  let employeeUser = systemUsers.find((entry) => entry.email === personaEmail('EMPLOYEE'));
  const scopedGrant = await api(`/system/users/${employeeUser.id}/overrides`, {
    method: 'POST', body: {
      permissionId: departmentRead.id, effect: 'GRANT', scopeType: 'ALL_SYSTEM', scopeIds: [departmentA.data.id],
      expectedAuthorizationVersion: employeeUser.authorizationVersion, reason: 'Scoped department integration grant',
    },
  }, systemAdmin);
  assert.equal(scopedGrant.status, 201);
  assert.equal((await api('/auth/me', {}, sessions.EMPLOYEE)).status, 401);
  sessions.EMPLOYEE = await loginRole('EMPLOYEE');
  const scopedDepartments = await api('/departments?limit=100', {}, sessions.EMPLOYEE);
  assert.deepEqual(scopedDepartments.data.map((department) => department.id), [departmentA.data.id]);
  assert.equal((await api(`/departments/${departmentB.data.id}`, {}, sessions.EMPLOYEE)).status, 404);

  systemUsers = (await api('/system/users?limit=100', {}, systemAdmin)).data;
  employeeUser = systemUsers.find((entry) => entry.email === personaEmail('EMPLOYEE'));
  const directDeny = await api(`/system/users/${employeeUser.id}/overrides`, {
    method: 'POST', body: {
      permissionId: announcementRead.id, effect: 'DENY', scopeType: 'ALL_SYSTEM', scopeIds: [],
      expectedAuthorizationVersion: employeeUser.authorizationVersion, reason: 'Direct deny precedence integration test',
    },
  }, systemAdmin);
  assert.equal(directDeny.status, 201);
  sessions.EMPLOYEE = await loginRole('EMPLOYEE');
  assert.equal((await api('/announcements', {}, sessions.EMPLOYEE)).status, 403);

  const revokedDeny = await api(`/system/users/${employeeUser.id}/overrides/${directDeny.data.id}/revoke`, {
    method: 'POST', body: { expectedVersion: directDeny.data.version, reason: 'Direct deny revocation integration test' },
  }, systemAdmin);
  assert.equal(revokedDeny.status, 201);

  const localUserEmail = `system.local.${Date.now()}@example.invalid`;
  const localUserPassword = 'SystemLocal123!';
  const localUserCreated = await api('/system/users', {
    method: 'POST', body: {
      email: localUserEmail, password: localUserPassword, localLoginEnabled: true, microsoftLoginEnabled: false,
      roleIds: [hrRole.id], reason: 'Local-only System administration integration account',
    },
  }, systemAdmin);
  assert.equal(localUserCreated.status, 201);
  assert.equal((await login(localUserEmail, localUserPassword)).user.email, localUserEmail);
  assert.equal((await api('/system/users', {
    method: 'POST', body: {
      email: localUserEmail, password: localUserPassword, localLoginEnabled: true, microsoftLoginEnabled: false,
      roleIds: [hrRole.id], reason: 'Duplicate local account rejection test',
    },
  }, systemAdmin)).status, 409);
  for (const [kind, localLoginEnabled] of [['microsoft-only', false], ['dual-login', true]]) {
    const email = `system.${kind}.${Date.now()}@example.invalid`;
    const result = await api('/system/users', {
      method: 'POST', body: {
        email, password: localLoginEnabled ? localUserPassword : undefined, localLoginEnabled, microsoftLoginEnabled: true,
        roleIds: [hrRole.id], reason: `Microsoft ${kind} provisioning failure test`,
      },
    }, systemAdmin);
    assert.equal(result.status, 503);
    assert.equal(await prisma.user.findUnique({ where: { email } }), null);
  }

  systemUsers = (await api('/system/users?limit=100', {}, systemAdmin)).data;
  let localUser = systemUsers.find((entry) => entry.email === localUserEmail);
  const localUserSession = await login(localUserEmail, localUserPassword);
  const disabledLocalUser = await api(`/system/users/${localUser.id}/status`, {
    method: 'PATCH', body: { isActive: false, expectedAuthorizationVersion: localUser.authorizationVersion, reason: 'System account disable integration test' },
  }, systemAdmin);
  assert.equal(disabledLocalUser.status, 200);
  assert.equal((await api('/auth/me', {}, localUserSession)).status, 401);
  assert.equal((await api(`/system/users/${localUser.id}/status`, {
    method: 'PATCH', body: { isActive: true, expectedAuthorizationVersion: localUser.authorizationVersion, reason: 'Stale account status test' },
  }, systemAdmin)).status, 409);
  const enabledLocalUser = await api(`/system/users/${localUser.id}/status`, {
    method: 'PATCH', body: { isActive: true, expectedAuthorizationVersion: disabledLocalUser.data.authorizationVersion, reason: 'System account enable integration test' },
  }, systemAdmin);
  assert.equal(enabledLocalUser.status, 200);

  const customRoleCode = `SYS_TEST_${Date.now()}`.slice(0, 30);
  const customRoleCreated = await api('/system/roles', {
    method: 'POST', body: { code: customRoleCode, displayName: 'System Test Role', permissionIds: [departmentRead.id], reason: 'Custom role creation integration test' },
  }, systemAdmin);
  assert.equal(customRoleCreated.status, 201);
  const customRoleUpdated = await api(`/system/roles/${customRoleCreated.data.id}`, {
    method: 'PATCH', body: { displayName: 'Updated System Test Role', expectedVersion: customRoleCreated.data.version, reason: 'Custom role update integration test' },
  }, systemAdmin);
  assert.equal(customRoleUpdated.status, 200);
  const permissionsReplaced = await api(`/system/roles/${customRoleCreated.data.id}/permissions`, {
    method: 'PUT', body: { permissionIds: [announcementRead.id], expectedVersion: customRoleUpdated.data.version, reason: 'Custom role permission replacement test' },
  }, systemAdmin);
  assert.equal(permissionsReplaced.status, 200);
  assert.equal((await api(`/system/roles/${customRoleCreated.data.id}/permissions`, {
    method: 'PUT', body: { permissionIds: [departmentRead.id], expectedVersion: customRoleUpdated.data.version, reason: 'Stale role permission replacement test' },
  }, systemAdmin)).status, 409);

  localUser = (await api('/system/users?limit=100', {}, systemAdmin)).data.find((entry) => entry.email === localUserEmail);
  const rolesAssigned = await api(`/system/users/${localUser.id}/roles`, {
    method: 'PUT', body: { roleIds: [hrRole.id, customRoleCreated.data.id], expectedAuthorizationVersion: localUser.authorizationVersion, reason: 'System role assignment integration test' },
  }, systemAdmin);
  assert.equal(rolesAssigned.status, 200);
  assert.equal((await api(`/system/roles/${customRoleCreated.data.id}`, {
    method: 'DELETE', body: { expectedVersion: permissionsReplaced.data.version, reason: 'Assigned role deletion rejection test' },
  }, systemAdmin)).status, 400);
  const disposableRole = await api('/system/roles', {
    method: 'POST', body: { code: `DEL_TEST_${Date.now()}`.slice(0, 30), displayName: 'Disposable System Role', permissionIds: [], reason: 'Disposable role deletion integration test' },
  }, systemAdmin);
  assert.equal(disposableRole.status, 201);
  assert.equal((await api(`/system/roles/${disposableRole.data.id}`, {
    method: 'DELETE', body: { expectedVersion: disposableRole.data.version, reason: 'Disposable role deletion integration test' },
  }, systemAdmin)).status, 200);

  const workflowPolicies = await api('/system/workflow-policy', {}, systemAdmin);
  assert.equal(workflowPolicies.status, 200);
  let hrPolicy = workflowPolicies.data.find((policy) => policy.stage === 'HR');
  assert.equal((await api('/system/workflow-policy/LEAVE/HR', {
    method: 'PUT', body: { mode: 'ANY_ONE', primaryUserId: sessions.HR.user.id, memberUserIds: [], expectedVersion: hrPolicy.version, reason: 'Invalid ANY_ONE policy integration test' },
  }, systemAdmin)).status, 400);
  const primaryPolicy = await api('/system/workflow-policy/LEAVE/HR', {
    method: 'PUT', body: { mode: 'PRIMARY_APPROVER', primaryUserId: sessions.HR.user.id, memberUserIds: [], expectedVersion: hrPolicy.version, reason: 'Primary workflow policy integration test' },
  }, systemAdmin);
  assert.equal(primaryPolicy.status, 200);
  const namedPoolPolicy = await api('/system/workflow-policy/LEAVE/HR', {
    method: 'PUT', body: { mode: 'NAMED_POOL', memberUserIds: [sessions.HR.user.id, sessions.CPO.user.id], expectedVersion: primaryPolicy.data.version, reason: 'Named-pool workflow policy integration test' },
  }, systemAdmin);
  assert.equal(namedPoolPolicy.status, 200);

  const delegationTimes = { startsAt: '2099-06-01T09:00:00.000Z', endsAt: '2099-06-02T09:00:00.000Z' };
  const delegation = await api('/system/delegations', {
    method: 'POST', body: { workflowType: 'LEAVE', stage: 'HR', delegatorUserId: sessions.HR.user.id, delegateUserId: sessions.CPO.user.id, ...delegationTimes, reason: 'Workflow delegation integration test' },
  }, systemAdmin);
  assert.equal(delegation.status, 201);
  assert.equal((await api('/system/delegations', {
    method: 'POST', body: { workflowType: 'LEAVE', stage: 'HR', delegatorUserId: sessions.HR.user.id, delegateUserId: sessions.CPO.user.id, ...delegationTimes, reason: 'Overlapping workflow delegation test' },
  }, systemAdmin)).status, 409);
  assert.equal((await api(`/system/delegations/${delegation.data.id}/revoke`, {
    method: 'POST', body: { expectedVersion: delegation.data.version, reason: 'Workflow delegation revocation integration test' },
  }, systemAdmin)).status, 201);

  const softDeleteEmail = `system.delete.${Date.now()}@example.invalid`;
  const softDeleteUser = await api('/system/users', {
    method: 'POST', body: { email: softDeleteEmail, password: localUserPassword, localLoginEnabled: true, microsoftLoginEnabled: false, roleIds: [hrRole.id], reason: 'Soft-deletion System integration account' },
  }, systemAdmin);
  assert.equal(softDeleteUser.status, 201);
  assert.equal((await api(`/system/users/${softDeleteUser.data.id}`, {
    method: 'DELETE', body: { expectedVersion: softDeleteUser.data.authorizationVersion, reason: 'System user soft-deletion integration test' },
  }, systemAdmin)).status, 200);
  assert.equal((await api('/system/users?limit=100', {}, systemAdmin)).data.some((entry) => entry.email === softDeleteEmail), false);

  const superAdminUser = systemUsers.find((entry) => entry.email === personaEmail('SUPER_ADMIN'));
  const selfStatusAttempt = await api(`/system/users/${superAdminUser.id}/status`, {
    method: 'PATCH', body: { isActive: false, expectedAuthorizationVersion: superAdminUser.authorizationVersion, reason: 'Self account-status protection test' },
  }, systemAdmin);
  assert.equal(selfStatusAttempt.status, 403, JSON.stringify(selfStatusAttempt.payload));

  sessions.EMPLOYEE = await loginRole('EMPLOYEE');
  const secondEmployeeSession = await loginRole('EMPLOYEE');
  const currentLogout = await api('/auth/logout', { method: 'POST' }, sessions.EMPLOYEE);
  assert.equal(currentLogout.status, 200);
  assert.equal((await api('/auth/me', {}, sessions.EMPLOYEE)).status, 401);
  assert.equal((await api('/auth/me', {}, secondEmployeeSession)).status, 200);
  assert.equal((await api('/auth/logout-all', { method: 'POST' }, secondEmployeeSession)).status, 200);
  assert.equal((await api('/auth/me', {}, secondEmployeeSession)).status, 401);

  const expiringSession = await loginRole('EMPLOYEE');
  await prisma.authSession.update({ where: { id: expiringSession.user.sessionId }, data: { expiresAt: new Date(0) } });
  assert.equal((await api('/auth/me', {}, expiringSession)).status, 401);
  const revokableSession = await loginRole('EMPLOYEE');
  assert.equal((await api(`/system/sessions/${revokableSession.user.sessionId}/revoke`, { method: 'POST', body: { reason: 'Administrative session revocation test' } }, systemAdmin)).status, 201);
  assert.equal((await api('/auth/me', {}, revokableSession)).status, 401);

  const notifications = await api('/notifications?limit=100', {}, sessions.HR);
  assert.equal(notifications.status, 200);
  assert.ok(notifications.data.length > 0);
  const auditList = await api('/audit/events?limit=100', {}, systemAdmin);
  assert.equal(auditList.status, 200);
  assert.doesNotMatch(JSON.stringify(auditList.data), /CheckerPass123|BlockedPass123|IntegrationPass123/);
  const chain = await api('/audit/events/verify-chain', {}, systemAdmin);
  assert.equal(chain.status, 200);
  assert.equal(chain.data.valid, true, JSON.stringify(chain.data));
  const auditEvent = await prisma.auditEvent.findFirstOrThrow({ orderBy: { sequence: 'asc' } });
  await assert.rejects(prisma.auditEvent.update({ where: { id: auditEvent.id }, data: { reason: 'tamper' } }));
  const auditExport = await api('/audit/events/exports', { method: 'POST', body: { format: 'CSV', exportReason: 'Integration audit export' } }, systemAdmin);
  assert.equal(auditExport.status, 201);
  const auditDownload = await api(`/audit/events/exports/${auditExport.data.id}/download`, {}, systemAdmin);
  assert.equal(auditDownload.status, 200);
  assert.match(auditDownload.buffer.toString('utf8'), /Resource Type/);
  const policy = await api('/audit/events/policy', {}, systemAdmin);
  assert.equal(policy.status, 200);
  const policyUpdate = await api('/audit/events/policy', {
    method: 'POST', body: { enabled: false, retentionDays: 365, expectedVersion: policy.data.version, reason: 'Keep retention disabled in integration test' },
  }, systemAdmin);
  assert.equal(policyUpdate.status, 201);
  const hold = await api('/audit/events/legal-holds', { method: 'POST', body: { name: 'Integration hold', reason: 'Audit legal hold integration test', resourceType: 'PayrollRun', resourceId: payroll.data.id } }, systemAdmin);
  assert.equal(hold.status, 201);
  assert.equal((await api(`/audit/events/legal-holds/${hold.data.id}/release`, { method: 'POST', body: { reason: 'Integration hold released' } }, systemAdmin)).status, 201);

  const databaseCounts = await Promise.all([
    prisma.role.count({ where: { isBuiltIn: true } }),
    prisma.permission.count({ where: { isDeprecated: false } }),
    prisma.auditEvent.count(),
  ]);
  assert.deepEqual(databaseCounts.slice(0, 2), [8, require('../prisma/rbac-catalog.json').permissions.length]);
  assert.ok(databaseCounts[2] > 30);

  const bulkTarget = await loginRole('EMPLOYEE');
  const searchedSessions = await api('/system/sessions?active=true&page=1&limit=10&search=rbac.employee', {}, systemAdmin);
  assert.equal(searchedSessions.status, 200);
  assert.ok(searchedSessions.data.length <= 10);
  assert.ok(searchedSessions.data.every((entry) => entry.user.email === personaEmail('EMPLOYEE')));
  const bulkRevocation = await api('/system/sessions/revoke-all', { method: 'POST', body: { reason: 'Administrative bulk session revocation test' } }, systemAdmin);
  assert.equal(bulkRevocation.status, 201);
  assert.equal(bulkRevocation.data.currentSessionRevoked, true);
  assert.ok(bulkRevocation.data.revokedCount >= 2);
  assert.equal((await api('/auth/me', {}, bulkTarget)).status, 401);
  assert.equal((await api('/auth/me', {}, systemAdmin)).status, 401);
});
