import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AuditAction } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { listRecords } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { QueryDepartmentsDto } from './dto/query-departments.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

const departmentInclude = {
  manager: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true },
  },
  _count: {
    select: {
      employees: { where: { deletedAt: null } },
      jobPositions: { where: { deletedAt: null } },
    },
  },
};

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateDepartmentDto, user: RequestUser) {
    this.assertSystemScope(user, 'department.manage');
    await this.validateManager(dto.managerId);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.create({ data: dto, include: departmentInclude });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Department', entityId: department.id, summary: 'Department created' });
      return department;
    });
  }

  list(query: QueryDepartmentsDto, user: RequestUser) {
    return listRecords(this.prisma.department, query, {
      searchFields: ['name', 'code', 'description'],
      allowedSortFields: ['createdAt', 'name', 'code'],
      defaultSortBy: 'createdAt',
      where: { AND: [this.systemWhere(user, 'department.read'), ...(query.managerId ? [{ managerId: query.managerId }] : [])] },
      include: departmentInclude,
    });
  }

  async findById(id: string, user: RequestUser) {
    const department = await this.prisma.department.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.systemWhere(user, 'department.read')] },
      include: departmentInclude,
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async update(id: string, dto: UpdateDepartmentDto, user: RequestUser) {
    await this.ensureExists(id);
    this.assertSystemScope(user, 'department.manage', id);
    await this.validateManager(dto.managerId);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.update({ where: { id }, data: dto, include: departmentInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Department', entityId: id, summary: 'Department updated' });
      return department;
    });
  }

  async remove(id: string, user: RequestUser) {
    await this.ensureExists(id);
    this.assertSystemScope(user, 'department.manage', id);
    const [employee, position] = await Promise.all([
      this.prisma.employee.findFirst({ where: { departmentId: id, deletedAt: null }, select: { id: true } }),
      this.prisma.jobPosition.findFirst({ where: { departmentId: id, deletedAt: null }, select: { id: true } }),
    ]);
    if (employee || position) {
      throw new BadRequestException('Reassign active employees and positions before deleting this department');
    }
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.update({ where: { id }, data: { deletedAt: new Date() }, include: departmentInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Department', entityId: id, summary: 'Department archived' });
      return department;
    });
  }

  private async validateManager(managerId?: string) {
    if (!managerId) return;
    const manager = await this.prisma.employee.findFirst({ where: { id: managerId, deletedAt: null } });
    if (!manager) throw new NotFoundException('Manager not found');
  }

  private systemWhere(user: RequestUser, permission: string) {
    const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_SYSTEM);
    return rule.unrestricted
      ? (rule.excludeIds.length ? { id: { notIn: rule.excludeIds } } : {})
      : { id: { in: rule.includeIds, notIn: rule.excludeIds } };
  }

  private assertSystemScope(user: RequestUser, permission: string, resourceId?: string) {
    if (this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ALL_SYSTEM, resourceId)) return;
    throw new NotFoundException(resourceId ? 'Department not found' : 'Resource not found');
  }

  private async ensureExists(id: string) {
    const department = await this.prisma.department.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }
}
