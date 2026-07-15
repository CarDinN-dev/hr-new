import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { listRecords } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
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
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateDepartmentDto, user: RequestUser) {
    await this.validateManager(dto.managerId);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.create({ data: dto, include: departmentInclude });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Department', entityId: department.id, summary: 'Department created' });
      return department;
    });
  }

  list(query: QueryDepartmentsDto) {
    return listRecords(this.prisma.department, query, {
      searchFields: ['name', 'code', 'description'],
      allowedSortFields: ['createdAt', 'name', 'code'],
      defaultSortBy: 'createdAt',
      where: query.managerId ? { managerId: query.managerId } : undefined,
      include: departmentInclude,
    });
  }

  async findById(id: string) {
    const department = await this.prisma.department.findFirst({
      where: { id, deletedAt: null },
      include: departmentInclude,
    });
    if (!department) throw new NotFoundException('Department not found');
    return department;
  }

  async update(id: string, dto: UpdateDepartmentDto, user: RequestUser) {
    await this.findById(id);
    await this.validateManager(dto.managerId);
    return this.prisma.$transaction(async (tx) => {
      const department = await tx.department.update({ where: { id }, data: dto, include: departmentInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Department', entityId: id, summary: 'Department updated' });
      return department;
    });
  }

  async remove(id: string, user: RequestUser) {
    await this.findById(id);
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
}
