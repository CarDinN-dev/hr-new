const { ConfigService } = require('@nestjs/config');
const { AuditAction, AuditOutcome, PrismaClient } = require('@prisma/client');
const { AuditService } = require('../dist/modules/audit/audit.service');
const { EmailDeliveryService } = require('../dist/modules/notifications/email-delivery.service');

const recipients = ['hr@med-tech.com', 'kashif@med-tech.com', 'athul@med-tech.com'];

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--confirm-production')) {
    throw new Error('Production test email requires --confirm-production.');
  }
  const prisma = new PrismaClient();
  const config = new ConfigService(process.env);
  const mail = new EmailDeliveryService(config, prisma);
  const audit = new AuditService(prisma, config, {}, {});
  const results = [];
  try {
    for (const recipient of recipients) {
      const user = await prisma.user.findFirst({
        where: { email: { equals: recipient, mode: 'insensitive' }, isActive: true, deletedAt: null },
        select: { id: true, email: true },
      });
      if (!user) {
        results.push({ recipient, accepted: false, error: 'Active account not found' });
        continue;
      }
      try {
        const accepted = await mail.sendAnnouncementTest(user.email);
        await audit.record(prisma, null, {
          action: AuditAction.CREATE,
          resourceType: 'AnnouncementEmailTest',
          resourceId: user.id,
          targetUserId: user.id,
          summary: 'Announcement email delivery test accepted by Microsoft Graph',
          metadata: { recipient: user.email, graphStatus: accepted.status, inlineImage: true, businessAnnouncementCreated: false },
        });
        results.push(accepted);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown delivery error';
        await audit.record(prisma, null, {
          action: AuditAction.CREATE,
          outcome: AuditOutcome.FAILED,
          resourceType: 'AnnouncementEmailTest',
          resourceId: user.id,
          targetUserId: user.id,
          summary: 'Announcement email delivery test failed',
          metadata: { recipient: user.email, error: message.slice(0, 300), inlineImage: true, businessAnnouncementCreated: false },
        });
        results.push({ recipient: user.email, accepted: false, error: message });
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  process.stdout.write(`${JSON.stringify({ subject: '[TEST] MedTech HR announcement email', inlineImage: true, results }, null, 2)}\n`);
  if (results.some(result => !result.accepted)) process.exitCode = 1;
}

main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
