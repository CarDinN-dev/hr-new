import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AuditAction, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

const announcementInclude = {
  department: true,
  createdBy: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateAnnouncementDto, user: RequestUser) {
    this.assertSystemScope(user, 'announcement.manage');
    if (!user.employeeId) throw new NotFoundException('Creator employee profile is required');
    const departmentId = await this.scopedDepartmentId(dto.departmentId, user);
    await this.assertAudienceScope(dto.audienceRoles);
    this.validateSchedule(dto.publishedAt, dto.expiresAt);
    return this.prisma.$transaction(async (tx) => {
      const { audienceRoles, ...input } = dto;
      const announcement = await tx.announcement.create({
        data: {
          ...input,
          departmentId,
          audienceRoleCodes: audienceRoles ?? [],
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
    if (query.audienceRole) filters.push({ audienceRoleCodes: { has: query.audienceRole } });
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
    this.assertSystemScope(user, 'announcement.manage', id);
    const departmentId = dto.departmentId;
    if (dto.departmentId) await this.ensureDepartment(dto.departmentId);
    await this.assertAudienceScope(dto.audienceRoles ?? announcement.audienceRoleCodes);
    this.validateSchedule(dto.publishedAt ?? announcement.publishedAt ?? undefined, dto.expiresAt ?? announcement.expiresAt ?? undefined);
    return this.prisma.$transaction(async (tx) => {
      const { audienceRoles, ...input } = dto;
      const updated = await tx.announcement.update({
        where: { id },
        data: { ...input, departmentId, ...(audienceRoles ? { audienceRoleCodes: audienceRoles } : {}) } as Prisma.AnnouncementUncheckedUpdateInput,
        include: announcementInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Announcement', entityId: id, summary: 'Announcement updated' });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    await this.ensureExists(id);
    this.assertSystemScope(user, 'announcement.manage', id);
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.announcement.update({ where: { id }, data: { deletedAt: new Date() }, include: announcementInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Announcement', entityId: id, summary: 'Announcement archived' });
      return removed;
    });
  }

  private async accessWhere(user: RequestUser): Promise<Prisma.AnnouncementWhereInput> {
    const scopes: Prisma.AnnouncementWhereInput[] = [];
    const manageRule = this.authorization.scopeRule(user, 'announcement.manage', AccessScopeType.ALL_SYSTEM);
    if (manageRule.unrestricted) {
      if (!manageRule.excludeIds.length) return {};
      scopes.push({ id: { notIn: manageRule.excludeIds } });
    }
    else if (manageRule.includeIds.length) scopes.push({ id: { in: manageRule.includeIds, notIn: manageRule.excludeIds } });

    const readRule = this.authorization.scopeRule(user, 'announcement.read', AccessScopeType.ALL_SYSTEM);
    if (!readRule.unrestricted && !readRule.includeIds.length) {
      return scopes.length ? { OR: scopes } : { id: '__no_announcement_scope__' };
    }
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
    const activeAudience: Prisma.AnnouncementWhereInput = {
      AND: [
        { isActive: true },
        { OR: [{ publishedAt: null }, { publishedAt: { lte: now } }] },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
        { OR: [{ audienceRoleCodes: { isEmpty: true } }, { audienceRoleCodes: { hasSome: user.roles } }] },
        departmentScope,
      ],
    };
    if (readRule.unrestricted && readRule.excludeIds.length) {
      activeAudience.AND = [...(activeAudience.AND as Prisma.AnnouncementWhereInput[]), { id: { notIn: readRule.excludeIds } }];
    } else if (!readRule.unrestricted) {
      activeAudience.AND = [...(activeAudience.AND as Prisma.AnnouncementWhereInput[]), { id: { in: readRule.includeIds, notIn: readRule.excludeIds } }];
    }
    scopes.push(activeAudience);
    return { OR: scopes };
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

  private async assertAudienceScope(audienceRoles: string[] | undefined) {
    if (audienceRoles?.some((role) => !/^[A-Z][A-Z0-9_]{1,99}$/.test(role))) {
      throw new ForbiddenException('Announcement audience is invalid');
    }
    if (!audienceRoles?.length) return;
    const count = await this.prisma.role.count({ where: { code: { in: [...new Set(audienceRoles)] }, isActive: true } });
    if (count !== new Set(audienceRoles).size) throw new BadRequestException('Announcement audience contains an unknown or inactive role');
  }

  private assertSystemScope(user: RequestUser, permission: string, resourceId?: string) {
    if (this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ALL_SYSTEM, resourceId)) return;
    throw new NotFoundException(resourceId ? 'Announcement not found' : 'Resource not found');
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
