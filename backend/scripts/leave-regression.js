const assert = require('node:assert/strict');
const test = require('node:test');
const { plainToInstance } = require('class-transformer');
const { DocumentScanStatus, Gender, LeaveDecisionType, LeaveRequestStatus, LeaveStepStatus, Prisma } = require('@prisma/client');
const { CreateLeaveRequestDto } = require('../dist/modules/leave/dto/create-leave-request.dto');
const { LeaveService } = require('../dist/modules/leave/leave.service');

const decimal = (value) => new Prisma.Decimal(value);
const leaveType = (code, allowance, isPaid = true, requiresAttachment = false) => ({
  id: `type-${code}`, name: code.split('_').map(word => `${word[0]}${word.slice(1).toLowerCase()}`).join(' '), code,
  annualAllowanceDays: decimal(allowance), isPaid, requiresAttachment,
});
const employee = (gender = Gender.FEMALE, hireDate = '2024-01-01') => ({ gender, hireDate: new Date(`${hireDate}T00:00:00Z`) });
const service = () => new LeaveService({}, {}, {}, {}, {});

test('canonical leave policies calculate paid and unpaid days on the correct calendars', () => {
  const leave = service();
  assert.equal(plainToInstance(CreateLeaveRequestDto, { isHalfDay: 'false' }, { enableImplicitConversion: true }).isHalfDay, false);
  assert.equal(plainToInstance(CreateLeaveRequestDto, { isHalfDay: 'true' }, { enableImplicitConversion: true }).isHalfDay, true);
  assert.equal(leave.parseIsHalfDay('false'), false);
  assert.equal(leave.parseIsHalfDay('true'), true);
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

test('cancel closes the active and remaining workflow steps without recording a rejection', async () => {
  const request = {
    id: 'request-1', requesterUserId: 'employee-user', employeeId: 'employee-1', leaveTypeId: 'unpaid',
    status: LeaveRequestStatus.PENDING_LINE_MANAGER, currentStage: 'LINE_MANAGER', workflowVersion: 1, version: 1,
    paidDays: decimal(0), startDate: new Date('2026-08-07T00:00:00Z'),
  };
  const stepUpdates = [];
  const tx = {
    idempotencyRecord: { deleteMany: async () => ({ count: 0 }), findUnique: async () => null, create: async () => ({}) },
    leaveRequest: {
      findFirst: async () => request,
      update: async ({ data }) => Object.assign(request, { status: data.status, currentStage: data.currentStage, version: request.version + 1 }),
      findUniqueOrThrow: async () => request,
    },
    leaveApprovalStep: {
      findFirst: async () => ({ id: 'step-1', version: 1, status: LeaveStepStatus.PENDING, assignees: [{ userId: 'line-manager-user' }] }),
      updateMany: async (args) => { stepUpdates.push(args); return { count: 1 }; },
    },
    leaveDecision: { create: async () => ({}) },
    employee: { findUnique: async () => ({ userId: 'employee-user' }) },
    notification: { createMany: async () => ({ count: 1 }) },
  };
  const prisma = { $transaction: async (operation) => operation(tx) };
  const leave = new LeaveService(prisma, { record: async () => ({}) }, { has: () => false }, {}, {});
  await leave.cancel('request-1', { expectedVersion: 1, reason: 'No longer required' }, 'cancel-key-123', { id: 'employee-user', employeeId: 'employee-1', roles: [], permissions: [] });

  assert.equal(stepUpdates[0].data.status, LeaveStepStatus.SKIPPED);
  assert.equal(stepUpdates[0].data.decisionType, LeaveDecisionType.CANCEL);
  assert.deepEqual(stepUpdates[1].where.id, { not: 'step-1' });
  assert.equal(stepUpdates[1].data.status, LeaveStepStatus.SKIPPED);
  assert.equal(request.status, LeaveRequestStatus.CANCELLED);
});

test('expired idempotency keys are pruned and can be reused', async () => {
  let stored = { requestHash: 'old-request', resourceId: 'old-request-id', expiresAt: new Date(0) };
  const tx = {
    idempotencyRecord: {
      deleteMany: async ({ where }) => {
        if (stored && stored.expiresAt <= where.expiresAt.lte) { stored = null; return { count: 1 }; }
        return { count: 0 };
      },
      findUnique: async () => stored,
    },
  };
  const result = await service().idempotentResult(tx, { id: 'employee-user' }, 'leave.cancel', 'expired-key-123', { requestId: 'request-1' });
  assert.equal(result, null);
  assert.equal(stored, null);
});

test('reject, return, and final approval close all unused steps in the workflow version', async () => {
  const cases = [
    [LeaveDecisionType.REJECT, LeaveRequestStatus.REJECTED, LeaveStepStatus.REJECTED],
    [LeaveDecisionType.RETURN, LeaveRequestStatus.RETURNED_FOR_CORRECTION, LeaveStepStatus.RETURNED],
    [LeaveDecisionType.APPROVE, LeaveRequestStatus.APPROVED, LeaveStepStatus.APPROVED],
  ];
  for (const [decision, nextStatus, expectedStepStatus] of cases) {
    const updates = [];
    const request = {
      id: `request-${decision}`, requesterUserId: 'employee-user', employeeId: 'employee-1', leaveTypeId: 'unpaid',
      status: LeaveRequestStatus.PENDING_COO, currentStage: 'COO', workflowVersion: 2, version: 4,
      paidDays: decimal(0), startDate: new Date('2026-08-07T00:00:00Z'),
    };
    const step = { id: `step-${decision}`, stage: 'COO', sequence: 5, version: 1, status: LeaveStepStatus.PENDING };
    const tx = {
      leaveType: { findFirst: async () => leaveType('UNPAID', 0, false) },
      leaveApprovalStep: {
        updateMany: async (args) => { updates.push(args); return { count: 1 }; },
        findFirst: async () => null,
      },
      leaveRequest: {
        updateMany: async () => ({ count: 1 }),
        findUniqueOrThrow: async () => ({ ...request, status: nextStatus }),
      },
      leaveDecision: { create: async () => ({}) },
      leaveApprovalStepAssignee: { findMany: async () => [] },
      employee: { findUnique: async () => ({ userId: 'employee-user' }) },
      notification: { createMany: async () => ({ count: 1 }) },
    };
    const leave = new LeaveService({}, { record: async () => ({}) }, {}, {}, {});
    await leave.completeDecision(tx, request, step, { id: 'approver-user', employeeId: 'approver-employee', roles: [], permissions: [] }, decision, nextStatus, decision === LeaveDecisionType.APPROVE ? undefined : 'Workflow decision reason');
    assert.equal(updates[0].data.status, expectedStepStatus, decision);
    assert.deepEqual(updates[1].where.id, { not: step.id }, decision);
    assert.equal(updates[1].data.status, LeaveStepStatus.SKIPPED, decision);
  }
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
