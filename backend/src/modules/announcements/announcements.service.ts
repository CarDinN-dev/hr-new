import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, LegacyRole, Prisma } from '@prisma/client';
import { hasAnyPermission, hasPermission } from '../../common/authorization';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const announcementInclude = {
  department: true,
  createdBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateAnnouncementDto, user: RequestUser) {
    if (!user.employeeId) throw new NotFoundException('Creator employee profile is required');
    const departmentId = await this.scopedDepartmentId(dto.departmentId, user);
    this.assertAudienceScope(dto.audienceRoles, user);
    this.validateSchedule(dto.publishedAt, dto.expiresAt);
    return this.prisma.$transaction(async (tx) => {
      const announcement = await tx.announcement.create({
        data: {
          ...dto,
          departmentId,
          audienceRoles: dto.audienceRoles ?? [],
          createdById: user.employeeId!,
        },
        include: announcementInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Announcement', entityId: announcement.id, summary: 'Announcement created' });
      return announcement;
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
    const departmentId = dto.departmentId;
    if (dto.departmentId) await this.ensureDepartment(dto.departmentId);
    this.assertAudienceScope(dto.audienceRoles ?? announcement.audienceRoles, user);
    this.validateSchedule(dto.publishedAt ?? announcement.publishedAt ?? undefined, dto.expiresAt ?? announcement.expiresAt ?? undefined);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.announcement.update({
        where: { id },
        data: { ...dto, departmentId } as Prisma.AnnouncementUncheckedUpdateInput,
        include: announcementInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Announcement', entityId: id, summary: 'Announcement updated' });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.announcement.update({ where: { id }, data: { deletedAt: new Date() }, include: announcementInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Announcement', entityId: id, summary: 'Announcement archived' });
      return removed;
    });
  }

  private async accessWhere(user: RequestUser) {
    if (hasPermission(user, 'announcement.manage')) return {};
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
        { OR: [{ audienceRoles: { isEmpty: true } }, { audienceRoles: { hasSome: this.legacyAudienceRoles(user) } }] },
        departmentScope,
      ],
    };
  }

  private async scopedDepartmentId(requestedDepartmentId: string | undefined, _user: RequestUser) {
    if (requestedDepartmentId) await this.ensureDepartment(requestedDepartmentId);
    return requestedDepartmentId;
  }

  private validateSchedule(publishedAt?: Date, expiresAt?: Date) {
    if (publishedAt && expiresAt && expiresAt <= publishedAt) {
      throw new BadRequestException('expiresAt must be after publishedAt');
    }
  }

  private assertAudienceScope(audienceRoles: LegacyRole[] | undefined, _user: RequestUser) {
    if (audienceRoles?.some((role) => !Object.values(LegacyRole).includes(role))) {
      throw new ForbiddenException('Announcement audience is invalid');
    }
  }

  private legacyAudienceRoles(user: RequestUser): LegacyRole[] {
    const roles = new Set<LegacyRole>();
    if (user.employeeId) roles.add(LegacyRole.EMPLOYEE);
    if (hasAnyPermission(user, ['employee.team.read', 'employee.department.read'])) roles.add(LegacyRole.MANAGER);
    if (hasAnyPermission(user, ['employee.hr.read', 'payroll.read', 'audit.read'])) roles.add(LegacyRole.HR_ADMIN);
    if (hasAnyPermission(user, ['user.manage', 'system.configure'])) roles.add(LegacyRole.SUPER_ADMIN);
    return [...roles];
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
