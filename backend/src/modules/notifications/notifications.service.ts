import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { EmailDeliveryService, LeaveEmailKind } from './email-delivery.service';

export type LeaveNotificationInput = {
  userIds: Array<string | null | undefined>;
  type: string;
  title: string;
  message: string;
  requestId: string;
  email?: {
    kind: LeaveEmailKind;
    stage?: string | null;
    previousStage?: string | null;
    status?: string | null;
    reason?: string;
  };
};

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService, private readonly email: EmailDeliveryService) {}

  async createLeave(tx: Prisma.TransactionClient, input: LeaveNotificationInput) {
    const userIds = [...new Set(input.userIds.filter((userId): userId is string => Boolean(userId)))];
    if (!userIds.length) return;
    if (!input.email || !this.email.enabled()) {
      await tx.notification.createMany({ data: userIds.map((userId) => ({
        userId, type: input.type, title: input.title, message: input.message,
        resourceType: 'LeaveRequest', resourceId: input.requestId,
      })) });
      return;
    }
    const [request, users] = await Promise.all([
      tx.leaveRequest.findUniqueOrThrow({
        where: { id: input.requestId },
        select: {
          startDate: true, endDate: true, totalDays: true, status: true, currentStage: true,
          employee: { select: { firstName: true, lastName: true, employeeCode: true } },
          leaveType: { select: { name: true } },
        },
      }),
      tx.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true, employee: { select: { firstName: true } } } }),
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const employeeName = `${request.employee.firstName} ${request.employee.lastName}`.trim();
    for (const userId of userIds) {
      const recipient = usersById.get(userId);
      if (!recipient) continue;
      const rendered = this.email.renderLeave({
        ...input.email,
        recipientName: recipient.employee?.firstName || 'there',
        employeeName,
        employeeCode: request.employee.employeeCode,
        leaveType: request.leaveType.name,
        startDate: request.startDate,
        endDate: request.endDate,
        totalDays: request.totalDays.toString(),
        stage: input.email.stage ?? request.currentStage,
        status: input.email.status ?? request.status,
      });
      await tx.notification.create({
        data: {
          userId, type: input.type, title: input.title, message: input.message,
          resourceType: 'LeaveRequest', resourceId: input.requestId,
          emailDelivery: { create: { recipientEmail: recipient.email, ...rendered } },
        },
      });
    }
  }

  async list(query: PaginationQueryDto, user: RequestUser) { const page = query.page ?? 1; const limit = query.limit ?? 20; const where = { userId: user.id }; const [data, total, unread] = await Promise.all([this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), this.prisma.notification.count({ where }), this.prisma.notification.count({ where: { userId: user.id, readAt: null } })]); return { data, meta: { ...paginationMeta(total, page, limit), unread } }; }
  async markRead(id: string, user: RequestUser) { const updated = await this.prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } }); if (!updated.count) throw new NotFoundException('Notification not found'); return this.prisma.notification.findUniqueOrThrow({ where: { id } }); }
  async markAllRead(user: RequestUser) { const result = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } }); return { updatedCount: result.count }; }
}
