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
    MICROSOFT_LOGIN_ENABLED: 'true',
    MICROSOFT_TENANT_ID: '11111111-1111-4111-8111-111111111111',
    MICROSOFT_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
    MICROSOFT_CLIENT_SECRET: 'integration-client-secret-value',
    MICROSOFT_REDIRECT_URI: `http://127.0.0.1:${port}/api/v1/auth/microsoft/callback`,
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
  assert.equal((await api('/system/users?limit=100', {}, sessions.ADMIN)).status, 200);
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

  const systemRoles = (await api('/system/roles', {}, sessions.ADMIN)).data;
  const hrRole = systemRoles.find((role) => role.code === 'HR');
  const lineManagerRole = systemRoles.find((role) => role.code === 'LINE_MANAGER');
  const checkerCreated = await api('/system/users', {
    method: 'POST',
    body: {
      email: 'rbac.checker@example.invalid', password: checkerPassword, localLoginEnabled: true, microsoftLoginEnabled: false,
      roleIds: [hrRole.id, lineManagerRole.id], reason: 'Maker-checker integration account',
    },
  }, sessions.ADMIN);
  assert.equal(checkerCreated.status, 201, JSON.stringify(checkerCreated.payload));
  assert.equal(Object.hasOwn(checkerCreated.data, 'passwordHash'), false);
  const checker = await login('rbac.checker@example.invalid', checkerPassword);
  assert.deepEqual(checker.user.roles.sort(), ['HR', 'LINE_MANAGER']);

  await prisma.payrollRun.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      year: 3000 + index, month: 1, status: 'PENDING_APPROVAL', generatedByUserId: sessions.HR.user.id,
    })),
  });
  const largeInbox = await api('/approvals/inbox', {}, checker);
  assert.equal(largeInbox.status, 200);
  assert.equal(largeInbox.data.payroll.length, 101);

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

  const nextYearBalance = await api('/leave/balances', {
    method: 'POST', body: { employeeId: sessions.EMPLOYEE.user.employeeId, leaveTypeId: annualLeave.id, year: 2100, totalDays: 30 },
  }, sessions.HR);
  assert.equal(nextYearBalance.status, 201, JSON.stringify(nextYearBalance.payload));
  let crossYearLeave = await mutate('/leave/submit', sessions.EMPLOYEE, {
    leaveTypeId: annualLeave.id, startDate: '2099-12-31', endDate: '2100-01-02', reason: 'Cross-year allocation integration',
  });
  assert.equal(crossYearLeave.status, 201, JSON.stringify(crossYearLeave.payload));
  for (const role of ['LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO']) {
    const approved = await mutate(`/leave/${crossYearLeave.data.id}/approve`, sessions[role], { expectedVersion: crossYearLeave.data.version, reason: `${role} cross-year approval` });
    assert.equal(approved.status, 201, JSON.stringify(approved.payload));
    crossYearLeave = approved;
  }
  const crossYearBalances = await api(`/leave/balances?employeeId=${sessions.EMPLOYEE.user.employeeId}&leaveTypeId=${annualLeave.id}&limit=100`, {}, sessions.HR);
  const year2099 = crossYearBalances.data.find((record) => record.year === 2099);
  const year2100 = crossYearBalances.data.find((record) => record.year === 2100);
  assert.equal(String(year2099.usedDays), '3');
  assert.equal(String(year2100.usedDays), '2');

  const hrSubmitted = await mutate('/leave/submit', sessions.HR, {
    employeeId: sessions.EMPLOYEE.user.employeeId, leaveTypeId: annualLeave.id,
    startDate: '2099-07-10', endDate: '2099-07-10', reason: 'HR submitted on behalf of employee',
  });
  assert.equal(hrSubmitted.status, 201, JSON.stringify(hrSubmitted.payload));

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
  const downloadedDocument = await api(`/documents/${uploadedDocument.data.id}/content`, {}, sessions.EMPLOYEE);
  assert.equal(downloadedDocument.status, 200);
  assert.equal(downloadedDocument.contentType.includes('application/pdf'), true);
  assert.equal(downloadedDocument.buffer.subarray(0, 4).toString(), '%PDF');

  const managerDocumentBody = new FormData();
  managerDocumentBody.set('employeeId', sessions.EMPLOYEE.user.employeeId);
  managerDocumentBody.set('documentType', 'Manager visible document');
  managerDocumentBody.set('visibility', 'MANAGER_AND_HR');
  managerDocumentBody.set('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }), 'manager-visible.pdf');
  const managerDocument = await api('/documents/upload', { method: 'POST', body: managerDocumentBody }, sessions.HR);
  assert.equal(managerDocument.status, 201, JSON.stringify(managerDocument.payload));
  assert.equal((await api(`/documents/${managerDocument.data.id}`, {}, sessions.LINE_MANAGER)).status, 200);
  assert.equal((await api(`/documents/${managerDocument.data.id}/content`, {}, sessions.LINE_MANAGER)).status, 200);

  const organizationDocumentBody = new FormData();
  organizationDocumentBody.set('documentType', 'Attendance register');
  organizationDocumentBody.set('visibility', 'PUBLIC');
  organizationDocumentBody.set('file', new Blob([Buffer.from('%PDF-1.4\n%%EOF')], { type: 'application/pdf' }), 'attendance-register.pdf');
  const organizationDocument = await api('/documents/upload', { method: 'POST', body: organizationDocumentBody }, sessions.HR);
  assert.equal(organizationDocument.status, 201, JSON.stringify(organizationDocument.payload));
  assert.equal(organizationDocument.data.employeeId, null);
  assert.equal(organizationDocument.data.visibility, 'HR_ONLY');
  assert.equal((await api(`/documents/${organizationDocument.data.id}/content`, {}, sessions.EMPLOYEE)).status, 404);
  const organizationDocumentDownload = await api(`/documents/${organizationDocument.data.id}/content`, {}, sessions.HR);
  assert.equal(organizationDocumentDownload.status, 200);
  assert.equal(organizationDocumentDownload.contentType.includes('application/pdf'), true);
  assert.equal(organizationDocumentDownload.buffer.subarray(0, 4).toString(), '%PDF');

  const importPayload = {
    rows: [
      {
        sourceId: 'local-manager', employeeCode: 'IMP-MANAGER', firstName: 'Import', lastName: 'Manager',
        email: 'import.manager@example.invalid', hireDate: '2026-02-01', departmentId: testDepartment.id, photo: 'data:image/png;base64,aGVsbG8=',
        salaryRecord: { baseSalary: '7000', allowances: '0', housingAllowance: '900', foodAllowance: '200', mobileAllowance: '100', specialAllowance: '50', deductions: '25', bonuses: '0', overtimeAmount: '75', taxRate: '5', effectiveFrom: '2026-02-01' },
      },
      {
        sourceId: 'local-report', employeeCode: 'IMP-REPORT', firstName: 'Import', lastName: 'Report',
        email: 'import.report@example.invalid', hireDate: '2026-02-01', departmentId: testDepartment.id, managerEmployeeCode: 'IMP-MANAGER',
      },
    ],
  };
  const importedEmployees = await api('/employees/import', { method: 'POST', body: importPayload }, sessions.HR);
  assert.equal(importedEmployees.status, 201, JSON.stringify(importedEmployees.payload));
  assert.equal(importedEmployees.data.imported, 2);
  assert.equal(importedEmployees.data.idMap.length, 2);
  const importedManager = importedEmployees.data.data.find((employee) => employee.employeeCode === 'IMP-MANAGER');
  const importedReport = importedEmployees.data.data.find((employee) => employee.employeeCode === 'IMP-REPORT');
  assert.equal(importedReport.managerId, importedManager.id);
  const importedSalary = await prisma.salaryRecord.findFirstOrThrow({ where: { employeeId: importedManager.id, deletedAt: null } });
  assert.equal(String(importedSalary.housingAllowance), '900');
  assert.equal(String(importedSalary.foodAllowance), '200');
  assert.equal(String(importedSalary.mobileAllowance), '100');
  assert.equal(String(importedSalary.specialAllowance), '50');
  assert.equal(String(importedSalary.overtimeAmount), '75');

  const employeeCountBeforeRollback = await prisma.employee.count();
  const rejectedEmployeeImport = await api('/employees/import', { method: 'POST', body: { rows: [
    { employeeCode: 'IMP-ROLLBACK-OK', firstName: 'Rollback', lastName: 'Valid', email: 'rollback.valid@example.invalid', hireDate: '2026-03-01', departmentId: testDepartment.id },
    { employeeCode: 'IMP-ROLLBACK-BAD', firstName: 'Rollback', lastName: 'Invalid', email: 'rollback.invalid@example.invalid', hireDate: '2026-03-01', departmentId: randomUUID() },
  ] } }, sessions.HR);
  assert.equal(rejectedEmployeeImport.status, 404);
  assert.equal(await prisma.employee.count(), employeeCountBeforeRollback);
  assert.equal(await prisma.employee.count({ where: { employeeCode: { startsWith: 'IMP-ROLLBACK-' } } }), 0);

  const attendanceImport = await api('/attendance/import', { method: 'POST', body: { rows: [
    { employeeId: importedReport.id, attendanceDate: '2096-01-01', status: 'PRESENT', notes: 'Atomic import' },
  ] } }, sessions.HR);
  assert.equal(attendanceImport.status, 201, JSON.stringify(attendanceImport.payload));
  const attendanceUpsert = await api('/attendance/import', { method: 'POST', body: { rows: [
    { employeeId: importedReport.id, attendanceDate: '2096-01-01', status: 'ABSENT', notes: 'Atomic upsert' },
  ] } }, sessions.HR);
  assert.equal(attendanceUpsert.status, 201, JSON.stringify(attendanceUpsert.payload));
  const importedAttendance = await prisma.attendance.findMany({ where: { employeeId: importedReport.id } });
  assert.equal(importedAttendance.length, 1);
  assert.equal(importedAttendance[0].status, 'ABSENT');
  const attendanceCountBeforeRollback = await prisma.attendance.count();
  const rejectedAttendanceImport = await api('/attendance/import', { method: 'POST', body: { rows: [
    { employeeId: importedReport.id, attendanceDate: '2096-01-02', status: 'PRESENT' },
    { employeeId: randomUUID(), attendanceDate: '2096-01-02', status: 'PRESENT' },
  ] } }, sessions.HR);
  assert.equal(rejectedAttendanceImport.status, 404);
  assert.equal(await prisma.attendance.count(), attendanceCountBeforeRollback);

  const recruitmentJob = await api('/recruitment/jobs', { method: 'POST', body: {
    title: 'Integration hire', departmentId: testDepartment.id, openings: 1, postedOn: '2026-04-01', description: 'Transactional hire test',
  } }, sessions.HR);
  assert.equal(recruitmentJob.status, 201, JSON.stringify(recruitmentJob.payload));
  let hireCandidate = await api('/recruitment/candidates', { method: 'POST', body: {
    jobId: recruitmentJob.data.id, name: 'Transactional Hire', email: 'transactional.hire@example.invalid', appliedOn: '2026-04-01',
  } }, sessions.HR);
  assert.equal(hireCandidate.status, 201, JSON.stringify(hireCandidate.payload));
  for (const stage of ['SCREENING', 'INTERVIEW', 'OFFER']) {
    hireCandidate = await api(`/recruitment/candidates/${hireCandidate.data.id}/stage`, { method: 'PATCH', body: { stage } }, sessions.HR);
    assert.equal(hireCandidate.status, 200, JSON.stringify(hireCandidate.payload));
  }
  const hired = await api(`/recruitment/candidates/${hireCandidate.data.id}/hire`, { method: 'POST', body: {
    employeeCode: 'HIRE-ATOMIC', firstName: 'Transactional', lastName: 'Hire', email: 'transactional.hire@example.invalid',
    hireDate: '2026-04-15', departmentId: testDepartment.id,
  } }, sessions.HR);
  assert.equal(hired.status, 201, JSON.stringify(hired.payload));
  assert.equal(hired.data.candidate.stage, 'HIRED');
  assert.equal(hired.data.candidate.employeeId, hired.data.employee.id);

  const spanningSalary = await api('/payroll/salary-records', { method: 'POST', body: {
    employeeId: hired.data.employee.id, baseSalary: '5000', housingAllowance: '500', effectiveFrom: '2097-12-15', effectiveTo: '2098-01-15',
  } }, sessions.HR);
  assert.equal(spanningSalary.status, 201, JSON.stringify(spanningSalary.payload));
  const spanningPayroll = await mutate('/payroll/runs', sessions.HR, { year: 2098, month: 1, employeeId: hired.data.employee.id });
  assert.equal(spanningPayroll.status, 201, JSON.stringify(spanningPayroll.payload));
  const rejectedSalaryDelete = await api(`/payroll/salary-records/${spanningSalary.data.id}`, { method: 'DELETE' }, sessions.HR);
  assert.equal(rejectedSalaryDelete.status, 400);
  const cancelledSpanningPayroll = await mutate(`/payroll/runs/${spanningPayroll.data.id}/cancel`, sessions.HR, {
    expectedVersion: spanningPayroll.data.version, reason: 'Complete salary overlap integration check',
  });
  assert.equal(cancelledSpanningPayroll.status, 201, JSON.stringify(cancelledSpanningPayroll.payload));

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
  const permissionCatalogue = (await api('/system/permissions', {}, sessions.ADMIN)).data;
  const departmentRead = permissionCatalogue.find((permission) => permission.code === 'department.read');
  const announcementRead = permissionCatalogue.find((permission) => permission.code === 'announcement.read');
  let systemUsers = (await api('/system/users?limit=100', {}, sessions.ADMIN)).data;
  let employeeUser = systemUsers.find((entry) => entry.email === personaEmail('EMPLOYEE'));
  const scopedGrant = await api(`/system/users/${employeeUser.id}/overrides`, {
    method: 'POST', body: {
      permissionId: departmentRead.id, effect: 'GRANT', scopeType: 'ALL_SYSTEM', scopeIds: [departmentA.data.id],
      expectedAuthorizationVersion: employeeUser.authorizationVersion, reason: 'Scoped department integration grant',
    },
  }, sessions.ADMIN);
  assert.equal(scopedGrant.status, 201);
  assert.equal((await api('/auth/me', {}, sessions.EMPLOYEE)).status, 401);
  sessions.EMPLOYEE = await loginRole('EMPLOYEE');
  const scopedDepartments = await api('/departments?limit=100', {}, sessions.EMPLOYEE);
  assert.deepEqual(scopedDepartments.data.map((department) => department.id), [departmentA.data.id]);
  assert.equal((await api(`/departments/${departmentB.data.id}`, {}, sessions.EMPLOYEE)).status, 404);

  systemUsers = (await api('/system/users?limit=100', {}, sessions.ADMIN)).data;
  employeeUser = systemUsers.find((entry) => entry.email === personaEmail('EMPLOYEE'));
  const directDeny = await api(`/system/users/${employeeUser.id}/overrides`, {
    method: 'POST', body: {
      permissionId: announcementRead.id, effect: 'DENY', scopeType: 'ALL_SYSTEM', scopeIds: [],
      expectedAuthorizationVersion: employeeUser.authorizationVersion, reason: 'Direct deny precedence integration test',
    },
  }, sessions.ADMIN);
  assert.equal(directDeny.status, 201);
  sessions.EMPLOYEE = await loginRole('EMPLOYEE');
  assert.equal((await api('/announcements', {}, sessions.EMPLOYEE)).status, 403);

  const superAdminUser = systemUsers.find((entry) => entry.email === personaEmail('SUPER_ADMIN'));
  const finalAdminAttempt = await api(`/system/users/${superAdminUser.id}/status`, {
    method: 'PATCH', body: { isActive: false, expectedAuthorizationVersion: superAdminUser.authorizationVersion, reason: 'Final administrator protection test' },
  }, sessions.ADMIN);
  assert.equal(finalAdminAttempt.status, 400);

  const blockedTermination = await api(`/employees/${blockedUser.employee.id}`, { method: 'DELETE' }, sessions.HR);
  assert.equal(blockedTermination.status, 200, JSON.stringify(blockedTermination.payload));
  const archivedEmployee = await prisma.employee.findUniqueOrThrow({ where: { id: blockedUser.employee.id } });
  const disabledAccount = await prisma.user.findUniqueOrThrow({ where: { id: blockedUser.id } });
  assert.ok(archivedEmployee.deletedAt);
  assert.equal(disabledAccount.isActive, false);
  assert.ok(await prisma.leaveRequest.count({ where: { employeeId: blockedUser.employee.id } }) > 0);
  assert.ok(await prisma.authSession.count({ where: { userId: blockedUser.id, revokedAt: { not: null } } }) > 0);
  assert.equal((await api('/auth/me', {}, blocked)).status, 401);

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
  assert.equal((await api(`/system/sessions/${revokableSession.user.sessionId}/revoke`, { method: 'POST', body: { reason: 'Administrative session revocation test' } }, sessions.ADMIN)).status, 201);
  assert.equal((await api('/auth/me', {}, revokableSession)).status, 401);

  const notifications = await api('/notifications?limit=100', {}, sessions.HR);
  assert.equal(notifications.status, 200);
  assert.ok(notifications.data.length > 0);
  const auditList = await api('/audit/events?limit=100', {}, sessions.ADMIN);
  assert.equal(auditList.status, 200);
  assert.doesNotMatch(JSON.stringify(auditList.data), /CheckerPass123|BlockedPass123|IntegrationPass123/);
  const chain = await api('/audit/events/verify-chain', {}, sessions.ADMIN);
  assert.equal(chain.status, 200);
  assert.equal(chain.data.valid, true, JSON.stringify(chain.data));
  const auditEvent = await prisma.auditEvent.findFirstOrThrow({ orderBy: { sequence: 'asc' } });
  await assert.rejects(prisma.auditEvent.update({ where: { id: auditEvent.id }, data: { reason: 'tamper' } }));
  const auditExport = await api('/audit/events/exports', { method: 'POST', body: { format: 'CSV', exportReason: 'Integration audit export' } }, sessions.ADMIN);
  assert.equal(auditExport.status, 201);
  const auditDownload = await api(`/audit/events/exports/${auditExport.data.id}/download`, {}, sessions.ADMIN);
  assert.equal(auditDownload.status, 200);
  assert.match(auditDownload.buffer.toString('utf8'), /Resource Type/);
  const policy = await api('/audit/events/policy', {}, sessions.ADMIN);
  assert.equal(policy.status, 200);
  const policyUpdate = await api('/audit/events/policy', {
    method: 'POST', body: { enabled: false, retentionDays: 365, expectedVersion: policy.data.version, reason: 'Keep retention disabled in integration test' },
  }, sessions.ADMIN);
  assert.equal(policyUpdate.status, 201);
  const hold = await api('/audit/events/legal-holds', { method: 'POST', body: { name: 'Integration hold', reason: 'Audit legal hold integration test', resourceType: 'PayrollRun', resourceId: payroll.data.id } }, sessions.ADMIN);
  assert.equal(hold.status, 201);
  assert.equal((await api(`/audit/events/legal-holds/${hold.data.id}/release`, { method: 'POST', body: { reason: 'Integration hold released' } }, sessions.ADMIN)).status, 201);

  const databaseCounts = await Promise.all([
    prisma.role.count({ where: { isBuiltIn: true } }),
    prisma.permission.count({ where: { isDeprecated: false } }),
    prisma.auditEvent.count(),
  ]);
  assert.deepEqual(databaseCounts.slice(0, 2), [8, require('../prisma/rbac-catalog.json').permissions.length]);
  assert.ok(databaseCounts[2] > 30);

  const bulkTarget = await loginRole('EMPLOYEE');
  const searchedSessions = await api('/system/sessions?active=true&page=1&limit=10&search=rbac.employee', {}, sessions.ADMIN);
  assert.equal(searchedSessions.status, 200);
  assert.ok(searchedSessions.data.length <= 10);
  assert.ok(searchedSessions.data.every((entry) => entry.user.email === personaEmail('EMPLOYEE')));
  const bulkRevocation = await api('/system/sessions/revoke-all', { method: 'POST', body: { reason: 'Administrative bulk session revocation test' } }, sessions.ADMIN);
  assert.equal(bulkRevocation.status, 201);
  assert.equal(bulkRevocation.data.currentSessionRevoked, true);
  assert.ok(bulkRevocation.data.revokedCount >= 2);
  assert.equal((await api('/auth/me', {}, bulkTarget)).status, 401);
  assert.equal((await api('/auth/me', {}, sessions.ADMIN)).status, 401);
});
