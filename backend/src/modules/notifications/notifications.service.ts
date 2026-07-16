import { Injectable, NotFoundException } from '@nestjs/common';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}
  async list(query: PaginationQueryDto, user: RequestUser) { const page = query.page ?? 1; const limit = query.limit ?? 20; const where = { userId: user.id }; const [data, total, unread] = await Promise.all([this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }), this.prisma.notification.count({ where }), this.prisma.notification.count({ where: { userId: user.id, readAt: null } })]); return { data, meta: { ...paginationMeta(total, page, limit), unread } }; }
  async markRead(id: string, user: RequestUser) { const updated = await this.prisma.notification.updateMany({ where: { id, userId: user.id }, data: { readAt: new Date() } }); if (!updated.count) throw new NotFoundException('Notification not found'); return this.prisma.notification.findUniqueOrThrow({ where: { id } }); }
  async markAllRead(user: RequestUser) { const result = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } }); return { updatedCount: result.count }; }
}
