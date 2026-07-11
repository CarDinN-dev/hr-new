import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';

const employeeInclude = {
  department: true,
  position: true,
  manager: {
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      email: true,
    },
  },
  user: {
    select: {
      id: true,
      email: true,
      role: true,
      isActive: true,
    },
  },
};

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEmployeeDto) {
    await this.validateRelations(dto);
    return this.prisma.employee.create({
      data: dto,
      include: employeeInclude,
    });
  }

  async list(query: QueryEmployeesDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];

    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.positionId) filters.push({ positionId: query.positionId });
    if (query.managerId) filters.push({ managerId: query.managerId });
    if (query.employmentStatus) filters.push({ employmentStatus: query.employmentStatus });

    const { page, limit, ...args } = listArgs(query, {
      searchFields: ['employeeCode', 'firstName', 'lastName', 'email', 'phone'],
      allowedSortFields: ['createdAt', 'employeeCode', 'firstName', 'lastName', 'hireDate', 'salary'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: employeeInclude,
    });

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany(args),
      this.prisma.employee.count({ where: args.where }),
    ]);

    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      include: employeeInclude,
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return employee;
  }

  async getMyProfile(user: RequestUser) {
    if (!user.employeeId) {
      throw new NotFoundException('No employee profile is linked to this user');
    }

    return this.findById(user.employeeId, user);
  }

  async update(id: string, dto: UpdateEmployeeDto) {
    await this.ensureExists(id);
    await this.validateRelations(dto, id);
    return this.prisma.employee.update({
      where: { id },
      data: dto,
      include: employeeInclude,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return softDelete(this.prisma.employee, id, 'Employee');
  }

  async ensureExists(id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  private accessWhere(user: RequestUser) {
    if (hasHrAccess(user.role)) {
      return {};
    }

    if (!user.employeeId) {
      return { id: '__no_employee_profile__' };
    }

    if (user.role === Role.MANAGER) {
      return { OR: [{ id: user.employeeId }, { managerId: user.employeeId }] };
    }

    return { id: user.employeeId };
  }

  private async validateRelations(dto: Partial<CreateEmployeeDto>, currentEmployeeId?: string) {
    if (dto.managerId && dto.managerId === currentEmployeeId) {
      throw new ForbiddenException('Employee cannot be their own manager');
    }

    const checks: Promise<unknown>[] = [];
    if (dto.departmentId) {
      checks.push(
        this.prisma.department.findFirst({
          where: { id: dto.departmentId, deletedAt: null },
        }),
      );
    }
    if (dto.positionId) {
      checks.push(
        this.prisma.jobPosition.findFirst({
          where: { id: dto.positionId, deletedAt: null },
        }),
      );
    }
    if (dto.managerId) {
      checks.push(
        this.prisma.employee.findFirst({
          where: { id: dto.managerId, deletedAt: null },
        }),
      );
    }
    if (dto.userId) {
      checks.push(
        this.prisma.user.findFirst({
          where: { id: dto.userId, deletedAt: null },
        }),
      );
    }

    const results = await Promise.all(checks);
    if (results.some((result) => !result)) {
      throw new NotFoundException('One or more referenced records were not found');
    }
  }
}
