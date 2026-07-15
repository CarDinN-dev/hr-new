import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { listRecords } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateJobPositionDto } from './dto/create-job-position.dto';
import { QueryJobPositionsDto } from './dto/query-job-positions.dto';
import { UpdateJobPositionDto } from './dto/update-job-position.dto';

const positionInclude = {
  department: true,
  _count: { select: { employees: { where: { deletedAt: null } } } },
};

@Injectable()
export class JobPositionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateJobPositionDto, user: RequestUser) {
    await this.validateDepartment(dto.departmentId);
    return this.prisma.$transaction(async (tx) => {
      const position = await tx.jobPosition.create({ data: dto, include: positionInclude });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'JobPosition', entityId: position.id, summary: 'Job position created' });
      return position;
    });
  }

  list(query: QueryJobPositionsDto) {
    return listRecords(this.prisma.jobPosition, query, {
      searchFields: ['title', 'code', 'description', 'level'],
      allowedSortFields: ['createdAt', 'title', 'code', 'level'],
      defaultSortBy: 'createdAt',
      where: query.departmentId ? { departmentId: query.departmentId } : undefined,
      include: positionInclude,
    });
  }

  async findById(id: string) {
    const position = await this.prisma.jobPosition.findFirst({
      where: { id, deletedAt: null },
      include: positionInclude,
    });
    if (!position) throw new NotFoundException('Job position not found');
    return position;
  }

  async update(id: string, dto: UpdateJobPositionDto, user: RequestUser) {
    await this.findById(id);
    await this.validateDepartment(dto.departmentId);
    return this.prisma.$transaction(async (tx) => {
      const position = await tx.jobPosition.update({ where: { id }, data: dto, include: positionInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'JobPosition', entityId: id, summary: 'Job position updated' });
      return position;
    });
  }

  async remove(id: string, user: RequestUser) {
    await this.findById(id);
    const employee = await this.prisma.employee.findFirst({
      where: { positionId: id, deletedAt: null },
      select: { id: true },
    });
    if (employee) throw new BadRequestException('Reassign active employees before deleting this job position');
    return this.prisma.$transaction(async (tx) => {
      const position = await tx.jobPosition.update({ where: { id }, data: { deletedAt: new Date() }, include: positionInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'JobPosition', entityId: id, summary: 'Job position archived' });
      return position;
    });
  }

  private async validateDepartment(departmentId?: string) {
    if (!departmentId) return;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, deletedAt: null },
    });
    if (!department) throw new NotFoundException('Department not found');
  }
}
