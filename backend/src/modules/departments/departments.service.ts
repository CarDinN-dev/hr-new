import { Injectable, NotFoundException } from '@nestjs/common';
import { listRecords, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { QueryDepartmentsDto } from './dto/query-departments.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';

const departmentInclude = {
  manager: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true },
  },
  _count: { select: { employees: true, jobPositions: true } },
};

@Injectable()
export class DepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDepartmentDto) {
    await this.validateManager(dto.managerId);
    return this.prisma.department.create({ data: dto, include: departmentInclude });
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

  async update(id: string, dto: UpdateDepartmentDto) {
    await this.findById(id);
    await this.validateManager(dto.managerId);
    return this.prisma.department.update({ where: { id }, data: dto, include: departmentInclude });
  }

  async remove(id: string) {
    await this.findById(id);
    return softDelete(this.prisma.department, id, 'Department');
  }

  private async validateManager(managerId?: string) {
    if (!managerId) return;
    const manager = await this.prisma.employee.findFirst({ where: { id: managerId, deletedAt: null } });
    if (!manager) throw new NotFoundException('Manager not found');
  }
}
