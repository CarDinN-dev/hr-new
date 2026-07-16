const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const requestedBatchSize = Number(process.env.AUDIT_RETENTION_BATCH_SIZE || 5_000);
if (!Number.isSafeInteger(requestedBatchSize) || requestedBatchSize < 100 || requestedBatchSize > 10_000) {
  throw new Error('AUDIT_RETENTION_BATCH_SIZE must be an integer from 100 to 10000');
}
const batchSize = requestedBatchSize;

function isHeld(event, holds) {
  return holds.some((hold) => (
    (!hold.resourceType || hold.resourceType === event.resourceType)
    && (!hold.resourceId || hold.resourceId === event.resourceId)
    && (!hold.workflowId || hold.workflowId === event.workflowId)
    && (!hold.subjectEmployeeId || hold.subjectEmployeeId === event.subjectEmployeeId)
  ));
}

async function main() {
  const policy = await prisma.auditRetentionPolicy.findUnique({ where: { id: 'default' } });
  if (!policy?.enabled) {
    console.log(JSON.stringify({ applied: false, reason: 'Audit retention is disabled', deleted: 0 }));
    return;
  }
  if (apply && process.env.AUDIT_RETENTION_CONFIRM !== 'DELETE_EXPIRED_AUDIT_EVENTS') {
    throw new Error('AUDIT_RETENTION_CONFIRM=DELETE_EXPIRED_AUDIT_EVENTS is required with --apply');
  }
  const now = new Date();
  const cutoff = new Date(now.getTime() - policy.retentionDays * 86_400_000);
  const holds = await prisma.auditLegalHold.findMany({
    where: { releasedAt: null, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
  });
  const candidates = await prisma.auditEvent.findMany({
    where: { occurredAtUtc: { lt: cutoff } },
    orderBy: { sequence: 'asc' },
    take: batchSize,
    select: { sequence: true, eventHash: true, resourceType: true, resourceId: true, workflowId: true, subjectEmployeeId: true },
  });
  const contiguous = [];
  for (const event of candidates) {
    if (isHeld(event, holds)) break;
    contiguous.push(event);
  }
  const report = {
    applied: apply,
    cutoff: cutoff.toISOString(),
    retentionDays: policy.retentionDays,
    legalHolds: holds.length,
    eligiblePrefix: contiguous.length,
    blockedByHold: contiguous.length < candidates.length,
    deleted: 0,
  };
  if (!apply || !contiguous.length) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const last = contiguous.at(-1);
  report.deleted = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL app.audit_maintenance = 'on'");
    await tx.auditChainState.update({
      where: { id: 'default' },
      data: { prunedThroughSequence: last.sequence, prunedThroughHash: last.eventHash, prunedAt: now },
    });
    return (await tx.auditEvent.deleteMany({ where: { sequence: { lte: last.sequence } } })).count;
  });
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
