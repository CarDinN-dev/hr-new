const assert = require('node:assert/strict');
const test = require('node:test');
const { createHmac } = require('node:crypto');
const { AuditAction, AuditOutcome, Prisma } = require('@prisma/client');
const { AuditService } = require('../dist/modules/audit/audit.service');

const config = { get: () => 'test-key', getOrThrow: () => 'test-key' };
const authorization = { permissionAllowedForScope: () => true };
const service = (prisma) => new AuditService(prisma, config, {}, authorization);

test('audit recording retries serialization failures', async () => {
  let attempts = 0;
  const transaction = {
    auditChainState: { upsert: async () => {}, update: async () => {} },
    $queryRaw: async () => [{ lastSequence: 0n, lastHash: null }],
    auditEvent: { create: async ({ data }) => data },
  };
  const prisma = {
    $transaction: async (operation) => {
      attempts += 1;
      if (attempts === 1) throw new Prisma.PrismaClientKnownRequestError('serialization failure', { code: 'P2010', clientVersion: 'test', meta: { code: '40001' } });
      return operation(transaction);
    },
  };

  const event = await service(prisma).record(prisma, null, { action: AuditAction.ACCESS, resourceType: 'AuditTest', summary: 'retry test' });
  assert.equal(attempts, 2);
  assert.equal(event.sequence, 1n);
});

function chainEvents(count) {
  const audit = service({});
  const events = [];
  let previousEventHash = null;
  for (let index = 1; index <= count; index += 1) {
    const occurredAtUtc = new Date(Date.UTC(2026, 0, 1, 0, 0, index));
    const payload = {
      sequence: String(index), occurredAtUtc: occurredAtUtc.toISOString(), actorUserId: null,
      actorEmployeeId: null, actorNameSnapshot: null, actorEmailSnapshot: null, actorRoleCodesSnapshot: [],
      action: AuditAction.ACCESS, module: 'audit', resourceType: 'AuditTest', resourceId: String(index),
      outcome: AuditOutcome.SUCCESS, reason: 'verify test', requestId: null, correlationId: null,
      subjectEmployeeId: null, subjectDepartmentId: null, targetUserId: null, permissionCode: null, scopeType: null,
      workflowId: null, workflowStage: null, workflowStatus: null, payrollPeriod: null, requestType: null,
      sessionId: null, ipHash: null, userAgent: null, route: null, httpMethod: null,
      isOverride: false, isSelfApproval: false, changedFields: [], before: null, after: null, metadata: null,
      previousEventHash,
    };
    const eventHash = createHmac('sha256', 'test-key').update(audit.canonical(payload)).digest('hex');
    events.push({
      ...payload,
      sequence: BigInt(index), occurredAtUtc,
      beforeJson: payload.before, afterJson: payload.after, metadataJson: payload.metadata,
      eventHash,
    });
    previousEventHash = eventHash;
  }
  return events;
}

function verificationPrisma(events, target, current = target) {
  let stateReads = 0;
  let pageReads = 0;
  return {
    auditChainState: {
      findUnique: async () => {
        stateReads += 1;
        return stateReads === 1 ? target : current;
      },
    },
    auditEvent: {
      findMany: async ({ where, take }) => {
        pageReads += 1;
        return events.filter((event) => event.sequence >= where.sequence.gte && event.sequence <= where.sequence.lte).slice(0, take);
      },
    },
    pageReads: () => pageReads,
  };
}

test('audit verification pages records, detects boundary tampering, and handles concurrent chain changes', async (context) => {
  const events = chainEvents(1_001);
  const target = { lastSequence: 1_001n, lastHash: events.at(-1).eventHash, prunedThroughSequence: 0n, prunedThroughHash: null };

  await context.test('uses multiple bounded pages and ignores a concurrent append', async () => {
    const current = { ...target, lastSequence: 1_002n, lastHash: 'new-append-hash' };
    const prisma = verificationPrisma(events, target, current);
    const result = await service(prisma).verifyChain({});
    assert.deepEqual(result, { valid: true, eventCount: 1_001, lastHash: target.lastHash });
    assert.equal(prisma.pageReads(), 2);
  });

  await context.test('detects tampering at a page boundary', async () => {
    const tampered = events.map((event) => ({ ...event }));
    tampered[999].eventHash = 'tampered';
    const result = await service(verificationPrisma(tampered, target)).verifyChain({});
    assert.deepEqual(result, { valid: false, brokenAtSequence: '1000', reason: 'event hash mismatch' });
  });

  await context.test('returns a retryable conflict when pruning changes the watermark', async () => {
    const current = { ...target, prunedThroughSequence: 1n, prunedThroughHash: events[0].eventHash };
    await assert.rejects(() => service(verificationPrisma(events, target, current)).verifyChain({}), /Audit retention changed during verification/);
  });

  await context.test('does not ignore events when chain state is missing', async () => {
    const prisma = { auditChainState: { findUnique: async () => null }, auditEvent: { count: async () => 1 } };
    assert.deepEqual(await service(prisma).verifyChain({}), { valid: false, reason: 'chain state mismatch' });
  });
});
