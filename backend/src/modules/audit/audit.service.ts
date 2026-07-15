import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';

type AuditClient = Prisma.TransactionClient | PrismaService;

export type AuditEntry = {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  summary: string;
  changes?: Array<{ field: string; previousValue?: string | null; nextValue?: string | null }>;
};

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(client: AuditClient, user: RequestUser | null, entry: AuditEntry) {
    return client.auditEvent.create({
      data: {
        actorUserId: user?.id,
        requestId: user?.requestId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: entry.summary,
        changes: entry.changes?.length ? { create: entry.changes } : undefined,
      },
    });
  }

  async list(query: PaginationQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where = { entityType: query.search || undefined };
    const [data, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where,
        include: { actor: { select: { id: true, email: true, role: true } }, changes: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }
}
