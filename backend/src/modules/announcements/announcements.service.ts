import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const announcementInclude = {
  department: true,
  createdBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateAnnouncementDto, user: RequestUser) {
    if (!user.employeeId) throw new NotFoundException('Creator employee profile is required');
    const departmentId = await this.scopedDepartmentId(dto.departmentId, user);
    this.validateSchedule(dto.publishedAt, dto.expiresAt);
    return this.prisma.announcement.create({
      data: {
        ...dto,
        departmentId,
        audienceRoles: dto.audienceRoles ?? [],
        createdById: user.employeeId,
      },
      include: announcementInclude,
    });
  }

  async list(query: QueryAnnouncementsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [await this.accessWhere(user)];
    if (query.audienceRole) filters.push({ audienceRoles: { has: query.audienceRole } });
    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.isActive !== undefined) filters.push({ isActive: query.isActive });

    const { page, limit, ...args } = listArgs(query, {
      searchFields: ['title', 'content'],
      allowedSortFields: ['createdAt', 'publishedAt', 'expiresAt', 'title'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: announcementInclude,
    });
    const [data, total] = await Promise.all([
      this.prisma.announcement.findMany(args),
      this.prisma.announcement.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const announcement = await this.prisma.announcement.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, await this.accessWhere(user)] },
      include: announcementInclude,
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  async update(id: string, dto: UpdateAnnouncementDto, user: RequestUser) {
    const announcement = await this.ensureExists(id);
    if (!hasHrAccess(user.role) && announcement.createdById !== user.employeeId) {
      throw new ForbiddenException('Managers can only update announcements they created');
    }
    const departmentId = hasHrAccess(user.role)
      ? dto.departmentId
      : await this.scopedDepartmentId(dto.departmentId ?? announcement.departmentId ?? undefined, user);
    if (hasHrAccess(user.role) && dto.departmentId) await this.ensureDepartment(dto.departmentId);
    this.validateSchedule(dto.publishedAt ?? announcement.publishedAt ?? undefined, dto.expiresAt ?? announcement.expiresAt ?? undefined);
    return this.prisma.announcement.update({
      where: { id },
      data: { ...dto, departmentId },
      include: announcementInclude,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return softDelete(this.prisma.announcement, id, 'Announcement');
  }

  private async accessWhere(user: RequestUser) {
    if (hasHrAccess(user.role)) return {};
    const now = new Date();
    const employee = user.employeeId
      ? await this.prisma.employee.findFirst({
          where: { id: user.employeeId, deletedAt: null },
          select: { departmentId: true },
        })
      : null;
    const departmentScope = employee?.departmentId
      ? { OR: [{ departmentId: null }, { departmentId: employee.departmentId }] }
      : { departmentId: null };
    return {
      AND: [
        { isActive: true },
        { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ audienceRoles: { isEmpty: true } }, { audienceRoles: { has: user.role } }] },
        departmentScope,
      ],
    };
  }

  private async scopedDepartmentId(requestedDepartmentId: string | undefined, user: RequestUser) {
    if (hasHrAccess(user.role)) {
      if (requestedDepartmentId) await this.ensureDepartment(requestedDepartmentId);
      return requestedDepartmentId;
    }
    if (!user.employeeId) throw new NotFoundException('Creator employee profile is required');
    const employee = await this.prisma.employee.findFirst({
      where: { id: user.employeeId, deletedAt: null },
      select: { departmentId: true },
    });
    if (!employee?.departmentId) throw new ForbiddenException('Managers must belong to a department to publish announcements');
    if (requestedDepartmentId && requestedDepartmentId !== employee.departmentId) {
      throw new ForbiddenException('Managers can only publish announcements to their own department');
    }
    return employee.departmentId;
  }

  private validateSchedule(publishedAt?: Date, expiresAt?: Date) {
    if (publishedAt && expiresAt && expiresAt <= publishedAt) {
      throw new BadRequestException('expiresAt must be after publishedAt');
    }
  }

  private async ensureDepartment(departmentId: string) {
    const department = await this.prisma.department.findFirst({ where: { id: departmentId, deletedAt: null } });
    if (!department) throw new NotFoundException('Department not found');
  }

  private async ensureExists(id: string) {
    const announcement = await this.prisma.announcement.findFirst({ where: { id, deletedAt: null } });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }
}
