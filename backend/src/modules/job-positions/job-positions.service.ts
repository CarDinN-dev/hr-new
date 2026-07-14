import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { listRecords, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateJobPositionDto } from './dto/create-job-position.dto';
import { QueryJobPositionsDto } from './dto/query-job-positions.dto';
import { UpdateJobPositionDto } from './dto/update-job-position.dto';

const positionInclude = {
  department: true,
  _count: { select: { employees: { where: { deletedAt: null } } } },
};

@Injectable()
export class JobPositionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateJobPositionDto) {
    await this.validateDepartment(dto.departmentId);
    return this.prisma.jobPosition.create({ data: dto, include: positionInclude });
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

  async update(id: string, dto: UpdateJobPositionDto) {
    await this.findById(id);
    await this.validateDepartment(dto.departmentId);
    return this.prisma.jobPosition.update({ where: { id }, data: dto, include: positionInclude });
  }

  async remove(id: string) {
    await this.findById(id);
    const employee = await this.prisma.employee.findFirst({
      where: { positionId: id, deletedAt: null },
      select: { id: true },
    });
    if (employee) throw new BadRequestException('Reassign active employees before deleting this job position');
    return softDelete(this.prisma.jobPosition, id, 'Job position');
  }

  private async validateDepartment(departmentId?: string) {
    if (!departmentId) return;
    const department = await this.prisma.department.findFirst({
      where: { id: departmentId, deletedAt: null },
    });
    if (!department) throw new NotFoundException('Department not found');
  }
}
