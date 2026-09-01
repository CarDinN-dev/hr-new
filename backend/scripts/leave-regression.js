const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { plainToInstance } = require('class-transformer');
const { ApproverMode, DocumentScanStatus, Gender, LeaveApprovalStage, LeaveRequestStatus, Prisma } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { CreateLeaveRequestDto } = require('../dist/modules/leave/dto/create-leave-request.dto');
const { LeaveService } = require('../dist/modules/leave/leave.service');
const { EmailDeliveryService } = require('../dist/modules/notifications/email-delivery.service');
const { NotificationsService } = require('../dist/modules/notifications/notifications.service');

const decimal = (value) => new Prisma.Decimal(value);
const leaveType = (code, allowance, isPaid = true, requiresAttachment = false) => ({
  id: `type-${code}`, name: code.split('_').map(word => `${word[0]}${word.slice(1).toLowerCase()}`).join(' '), code,
  annualAllowanceDays: decimal(allowance), isPaid, requiresAttachment,
});
const employee = (gender = Gender.FEMALE, hireDate = '2024-01-01') => ({ gender, hireDate: new Date(`${hireDate}T00:00:00Z`) });
const service = () => new LeaveService({}, {}, {}, {}, {});
const mailKeyDirectory = mkdtempSync(join(tmpdir(), 'medtech-mail-test-'));
const mailKeyPath = join(mailKeyDirectory, 'private-key.pem');
writeFileSync(mailKeyPath, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
test.after(() => rmSync(mailKeyDirectory, { recursive: true, force: true }));

test('multipart false remains a false half-day value', () => {
  const request = plainToInstance(CreateLeaveRequestDto, { isHalfDay: 'false' }, { enableImplicitConversion: true });
  assert.equal(request.isHalfDay, false);
});

test('canonical leave policies calculate paid and unpaid days on the correct calendars', () => {
  const leave = service();
  const compassionate = leave.leavePolicy(employee(), leaveType('COMPASSIONATE', 3), new Date('2026-08-06T00:00:00Z'), new Date('2026-08-12T00:00:00Z'), false);
  assert.equal(compassionate.totalDays.toFixed(2), '5.00');
  assert.equal(compassionate.paidDays.toFixed(2), '3.00');
  const umrah = leave.leavePolicy(employee(), leaveType('UMRAH_HAJJ', 0, false), new Date('2026-08-06T00:00:00Z'), new Date('2026-08-12T00:00:00Z'), false);
  assert.equal(umrah.totalDays.toFixed(2), '7.00');
  assert.equal(umrah.paidDays.toFixed(2), '0.00');
  assert.throws(() => leave.leavePolicy(employee(), leaveType('COMPASSIONATE', 3), new Date('2026-08-06T00:00:00Z'), new Date('2026-08-06T00:00:00Z'), true), /Half-day selection/);
});

test('maternity requires eligibility, a certificate, and allows exactly 50 days across years', () => {
  const leave = service();
  const maternity = leaveType('MATERNITY', 50, true, true);
  const policy = leave.leavePolicy(employee(), maternity, new Date('2026-12-15T00:00:00Z'), new Date('2027-02-02T00:00:00Z'), false);
  assert.equal(policy.totalDays.toFixed(2), '50.00');
  assert.equal(policy.paidDays.toFixed(2), '50.00');
  assert.equal(policy.balanceYear, 2026);
  assert.equal(policy.requiresAttachment, true);
  assert.throws(() => leave.leavePolicy(employee(), maternity, new Date('2026-12-15T00:00:00Z'), new Date('2027-02-01T00:00:00Z'), false), /exactly 50/);
  assert.throws(() => leave.leavePolicy(employee(Gender.MALE), maternity, new Date('2026-12-15T00:00:00Z'), new Date('2027-02-02T00:00:00Z'), false), /Female employee/);
  assert.throws(() => leave.leavePolicy(employee(Gender.FEMALE, '2026-01-01'), maternity, new Date('2026-06-01T00:00:00Z'), new Date('2026-07-20T00:00:00Z'), false), /service year/);
  assert.throws(() => leave.leavePolicy(employee(), leaveType('ANNUAL', 30), new Date('2026-12-31T00:00:00Z'), new Date('2027-01-01T00:00:00Z'), false), /Only maternity/);
});

test('balance initialization, reservation, finalization, release, and insufficiency use paid days only', async () => {
  const type = leaveType('COMPASSIONATE', 3);
  const balance = { id: 'balance-1', employeeId: 'employee-1', leaveTypeId: type.id, year: 2026, totalDays: decimal(5), usedDays: decimal(1), pendingDays: decimal(0), deletedAt: null };
  const tx = {
    leaveType: { findFirst: async () => type },
    leaveBalance: {
      findFirst: async () => balance,
      findUniqueOrThrow: async () => balance,
      create: async ({ data }) => ({ id: 'new-balance', ...data, usedDays: decimal(0), pendingDays: decimal(0), deletedAt: null }),
      update: async ({ data }) => {
        if (data.pendingDays?.increment) balance.pendingDays = balance.pendingDays.plus(data.pendingDays.increment);
        if (data.pendingDays?.decrement) balance.pendingDays = balance.pendingDays.minus(data.pendingDays.decrement);
        if (data.usedDays?.increment) balance.usedDays = balance.usedDays.plus(data.usedDays.increment);
        if (data.usedDays?.decrement) balance.usedDays = balance.usedDays.minus(data.usedDays.decrement);
        return balance;
      },
    },
  };
  const leave = service();
  await leave.reserveBalance(tx, 'employee-1', type, 2026, decimal(3));
  assert.equal(balance.pendingDays.toFixed(2), '3.00');
  await assert.rejects(() => leave.reserveBalance(tx, 'employee-1', type, 2026, decimal(2)), /Insufficient leave balance/);
  const request = { employeeId: 'employee-1', leaveTypeId: type.id, startDate: new Date('2026-08-06T00:00:00Z'), paidDays: decimal(3), status: LeaveRequestStatus.PENDING_LINE_MANAGER };
  await leave.finalizeBalance(tx, request);
  assert.equal(balance.usedDays.toFixed(2), '4.00');
  assert.equal(balance.pendingDays.toFixed(2), '0.00');
  await leave.releaseBalance(tx, { ...request, status: LeaveRequestStatus.APPROVED }, true);
  assert.equal(balance.usedDays.toFixed(2), '1.00');
});

test('required attachments must scan clean and remain hidden from ordinary managers', async () => {
  const sick = leaveType('SICK', 14, true, true);
  let clean = false;
  const prisma = { employeeDocument: { findFirst: async () => clean ? { id: 'document-1' } : null, findMany: async () => [{ id: 'document-1', fileName: 'certificate.pdf', scanStatus: DocumentScanStatus.CLEAN }] } };
  const authorization = { permissionAllowedForScope: (actor, permission) => actor.permissions.includes(permission) };
  const leave = new LeaveService(prisma, {}, authorization, {}, {});
  const tx = { leaveType: { findFirst: async () => sick }, employeeDocument: prisma.employeeDocument };
  await assert.rejects(() => leave.assertRequiredAttachmentClean(tx, { id: 'request-1', leaveTypeId: sick.id }), /must pass malware scanning/);
  clean = true;
  await assert.doesNotReject(() => leave.assertRequiredAttachmentClean(tx, { id: 'request-1', leaveTypeId: sick.id }));
  const request = { id: 'request-1', employeeId: 'employee-1', totalDays: decimal(2), paidDays: decimal(2) };
  const actors = [
    { label: 'employee', employeeId: 'employee-1', permissions: [] },
    { label: 'HR', employeeId: 'hr', permissions: ['leave.hr.read'] },
    { label: 'CPO', employeeId: 'cpo', permissions: ['leave.read_all'] },
    { label: 'COO', employeeId: 'coo', permissions: ['leave.read_all'] },
    { label: 'Admin', employeeId: 'admin', permissions: ['leave.read_all'] },
    { label: 'Super Admin', employeeId: 'super', permissions: ['leave.read_all'] },
  ];
  for (const actor of actors) assert.equal((await leave.presentRequest(request, actor)).attachments.length, 1, actor.label);
  assert.equal((await leave.presentRequest(request, { employeeId: 'manager', permissions: ['leave.team.read'] })).attachments.length, 0);
});

const emailService = (prisma = {}) => new EmailDeliveryService(new ConfigService({
  LEAVE_EMAIL_ENABLED: 'true',
  MAIL_FROM: 'no-reply@med-tech.com',
  HR_ERP_URL: 'https://hr.example.test',
  MAIL_GRAPH_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  MAIL_GRAPH_CLIENT_ID: '22222222-2222-4222-8222-222222222222',
  MAIL_GRAPH_CERT_THUMBPRINT: '1111111111111111111111111111111111111111',
  MAIL_GRAPH_CERT_PATH: mailKeyPath,
}), prisma);

test('leave email copy escapes dynamic HTML and keeps the branded leave link', () => {
  assert.equal(new EmailDeliveryService(new ConfigService({ LEAVE_EMAIL_ENABLED: 'false' }), {}).enabled(), false);
  assert.throws(() => new EmailDeliveryService(new ConfigService({ LEAVE_EMAIL_ENABLED: 'true' }), {}), /MAIL_GRAPH_TENANT_ID/);
  const mail = emailService();
  const rendered = mail.renderLeave({
    kind: 'RETURNED', recipientName: '<Manager>', employeeName: 'A&B <Test>', employeeCode: 'EMP<7>',
    leaveType: 'Annual <Leave>', startDate: new Date('2026-08-13T00:00:00Z'), endDate: new Date('2026-08-14T00:00:00Z'),
    totalDays: '2', stage: 'LINE_MANAGER', reason: '<script>alert("x")</script>',
  });
  assert.equal(rendered.subject, 'Action required: leave request returned for correction');
  assert.match(rendered.htmlBody, /Hi &lt;Manager&gt;/);
  assert.match(rendered.htmlBody, /A&amp;B &lt;Test&gt;/);
  assert.doesNotMatch(rendered.htmlBody, /Decision reason|script/);
  assert.doesNotMatch(rendered.htmlBody, /<script>/);
  assert.match(rendered.htmlBody, /cid:medtech-logo/);
  assert.match(rendered.htmlBody, /alt="MedTech logo"/);
  assert.match(rendered.htmlBody, /https:\/\/hr\.example\.test\/leave/);
  assert.match(mail.renderLeave({
    kind: 'APPROVAL_REQUIRED', recipientName: 'Manager', employeeName: 'Pat\r\nBcc: bad@example.test', employeeCode: 'EMP-7',
    leaveType: 'Annual', startDate: new Date('2026-08-13T00:00:00Z'), endDate: new Date('2026-08-13T00:00:00Z'), totalDays: '1', stage: 'MANAGER',
  }).subject, /^Action required: Pat Bcc: bad@example\.test’s leave request$/);
  const progress = mail.renderLeave({
    kind: 'PROGRESS', recipientName: 'Pat', employeeName: 'Pat Lee', employeeCode: 'EMP-7', leaveType: 'Annual',
    startDate: new Date('2026-08-13T00:00:00Z'), endDate: new Date('2026-08-14T00:00:00Z'), totalDays: '2', previousStage: 'LINE_MANAGER', stage: 'MANAGER',
  });
  assert.match(progress.subject, /^Leave request progressed — Annual$/);
  assert.match(progress.htmlBody, /approved by the Line Manager stage and is now awaiting Manager review/);
});

test('leave notifications queue one transactional email per unique recipient only when requested', async () => {
  const created = [];
  const tx = {
    leaveRequest: { findUniqueOrThrow: async () => ({
      startDate: new Date('2026-08-13T00:00:00Z'), endDate: new Date('2026-08-14T00:00:00Z'), totalDays: decimal(2),
      status: LeaveRequestStatus.PENDING_LINE_MANAGER, currentStage: LeaveApprovalStage.LINE_MANAGER,
      employee: { firstName: 'Pat', lastName: 'Lee', employeeCode: 'EMP-7' }, leaveType: { name: 'Annual' },
    }) },
    user: { findMany: async () => [{ id: 'employee-user', email: 'employee@example.test', employee: { firstName: 'Pat' } }] },
    notification: {
      create: async ({ data }) => { created.push(data); return data; },
      createMany: async ({ data }) => { created.push(...data); return { count: data.length }; },
    },
  };
  const notifications = new NotificationsService({}, emailService());
  await notifications.createLeave(tx, {
    userIds: ['employee-user', 'employee-user'], type: 'LEAVE_SUBMITTED', title: 'Submitted', message: 'Submitted', requestId: 'leave-1',
    email: { kind: 'SUBMITTED' },
  });
  assert.equal(created.length, 1);
  assert.equal(created[0].emailDelivery.create.recipientEmail, 'employee@example.test');
  assert.match(created[0].emailDelivery.create.subject, /^Leave request submitted — Annual$/);
  await notifications.createLeave(tx, {
    userIds: ['employee-user'], type: 'LEAVE_STATUS', title: 'Updated', message: 'Intermediate approval', requestId: 'leave-1',
    email: { kind: 'PROGRESS', previousStage: 'LINE_MANAGER', stage: 'MANAGER' },
  });
  assert.match(created[1].emailDelivery.create.subject, /^Leave request progressed — Annual$/);
  const disabled = new NotificationsService({}, new EmailDeliveryService(new ConfigService({ LEAVE_EMAIL_ENABLED: 'false' }), {}));
  await disabled.createLeave(tx, {
    userIds: ['employee-user'], type: 'LEAVE_SUBMITTED', title: 'Submitted', message: 'Submitted', requestId: 'leave-1',
    email: { kind: 'SUBMITTED' },
  });
  assert.equal(created[2].emailDelivery, undefined);
});

test('standard and shortened leave routes retain their exact approval stages', async () => {
  const requesterRoles = new Map();
  const tx = {
    userRole: { findMany: async ({ where }) => [{ role: { code: requesterRoles.get(where.userId) ?? (where.userId === 'line-user' ? 'LINE_MANAGER' : 'MANAGER') } }] },
    employee: { findFirst: async ({ where }) => ({ userId: where.id === 'line-employee' ? 'line-user' : 'manager-user' }) },
    workflowStagePolicy: { findUnique: async () => ({ mode: ApproverMode.ANY_ONE, primaryUserId: null, members: [] }) },
    user: {
      findMany: async ({ where }) => [{ id: `${where.roles.some.role.code.toLowerCase()}-user` }],
      findFirst: async ({ where }) => ({ id: where.id }),
    },
    workflowDelegation: { findMany: async () => [] },
  };
  const leave = service();
  const subject = { id: 'employee-1', lineManagerId: 'line-employee', managerId: 'manager-employee', departmentId: 'department-1' };
  const cases = [
    ['EMPLOYEE', ['LINE_MANAGER', 'MANAGER', 'HR', 'CPO', 'COO']],
    ['LINE_MANAGER', ['MANAGER', 'HR', 'CPO', 'COO']],
    ['MANAGER', ['HR', 'CPO', 'COO']],
    ['HR', ['CPO', 'COO']],
    ['CPO', ['COO']],
    ['COO', ['COO']],
  ];
  for (const [role, expected] of cases) {
    const requester = `requester-${role.toLowerCase()}`;
    requesterRoles.set(requester, role);
    const plan = await leave.workflowPlan(tx, subject, requester, 1);
    assert.deepEqual(plan.steps.map(({ stage }) => stage), expected, role);
    assert.equal(plan.blocked, undefined, role);
  }
});

test('Graph mail accepts 202 and retries auth, timeout, throttling, and server failures', async () => {
  const originalFetch = global.fetch;
  const delivery = { id: 'delivery-1', recipientEmail: 'approver@example.test', subject: 'Subject', htmlBody: '<p>Body</p>', attempts: 0 };
  const run = async (fetchImpl) => {
    const updates = [];
    const prisma = {
      emailDelivery: {
        findMany: async () => [delivery],
        update: async (args) => { updates.push(args); return args; },
      },
    };
    const mail = emailService(prisma);
    mail.logger.warn = () => {};
    global.fetch = fetchImpl;
    await mail.deliverPending();
    return updates[0].data;
  };
  try {
    const calls = [];
    const success = await run(async (url, options) => {
      calls.push([String(url), options]);
      return calls.length === 1
        ? new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(null, { status: 202 });
    });
    assert.ok(success.sentAt instanceof Date);
    const authBody = new URLSearchParams(calls[0][1].body);
    assert.equal(authBody.get('client_secret'), null);
    assert.ok(authBody.get('client_assertion'));
    assert.equal(calls[1][0], 'https://graph.microsoft.com/v1.0/users/no-reply%40med-tech.com/sendMail');
    const graphBody = JSON.parse(calls[1][1].body);
    assert.equal(graphBody.message.attachments[0].contentId, 'medtech-logo');
    assert.equal(graphBody.message.attachments[0].isInline, true);
    assert.ok(graphBody.message.attachments[0].contentBytes.length > 100);

    const auth = await run(async () => new Response(null, { status: 401 }));
    assert.equal(auth.attempts, 1);
    assert.match(auth.lastError, /authentication returned HTTP 401/);

    const timeout = await run(async () => { throw new Error('timeout'); });
    assert.match(timeout.lastError, /authentication could not be reached/);

    let calls429 = 0;
    const throttledAt = Date.now();
    const throttled = await run(async () => ++calls429 === 1
      ? new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(null, { status: 429, headers: { 'retry-after': '17' } }));
    assert.ok(throttled.nextAttemptAt.getTime() >= throttledAt + 16_000 && throttled.nextAttemptAt.getTime() <= throttledAt + 19_000);

    let calls503 = 0;
    const failedAt = Date.now();
    const failed = await run(async () => ++calls503 === 1
      ? new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response(null, { status: 503 }));
    assert.ok(failed.nextAttemptAt.getTime() >= failedAt + 59_000 && failed.nextAttemptAt.getTime() <= failedAt + 62_000);
  } finally {
    global.fetch = originalFetch;
  }
});
