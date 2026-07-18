const assert = require('node:assert/strict');
const { AuditAction, Prisma } = require('@prisma/client');
const { AuditService } = require('../dist/modules/audit/audit.service');

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

new AuditService(prisma, { get: () => 'test-key', getOrThrow: () => 'test-key' }, {}, {})
  .record(prisma, null, { action: AuditAction.ACCESS, resourceType: 'AuditTest', summary: 'retry test' })
  .then((event) => {
    assert.equal(attempts, 2);
    assert.equal(event.sequence, 1n);
    console.log('audit concurrency retry passed');
  });
