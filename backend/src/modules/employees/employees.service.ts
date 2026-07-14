import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
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
    const employee = await this.ensureExists(id);
    await this.validateRelations(dto, id, employee);
    return this.prisma.employee.update({
      where: { id },
      data: dto,
      include: employeeInclude,
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id, deletedAt: null } });
      if (!employee) throw new NotFoundException('Employee not found');
      const [directReport, managedDepartment] = await Promise.all([
        tx.employee.findFirst({ where: { managerId: id, deletedAt: null }, select: { id: true } }),
        tx.department.findFirst({ where: { managerId: id, deletedAt: null }, select: { id: true } }),
      ]);
      if (directReport || managedDepartment) {
        throw new BadRequestException('Reassign direct reports and managed departments before deleting this employee');
      }

      const removed = await tx.employee.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
      if (employee.userId) {
        await tx.user.update({
          where: { id: employee.userId },
          data: { isActive: false, sessionVersion: { increment: 1 } },
        });
      }
      return removed;
    });
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

  private async validateRelations(
    dto: Partial<CreateEmployeeDto>,
    currentEmployeeId?: string,
    current?: { departmentId: string | null; positionId: string | null },
  ) {
    if (dto.managerId && dto.managerId === currentEmployeeId) {
      throw new ForbiddenException('Employee cannot be their own manager');
    }

    const departmentId = dto.departmentId ?? current?.departmentId ?? undefined;
    const positionId = dto.positionId ?? current?.positionId ?? undefined;
    const [department, position, user] = await Promise.all([
      departmentId
        ? this.prisma.department.findFirst({ where: { id: departmentId, deletedAt: null } })
        : null,
      positionId
        ? this.prisma.jobPosition.findFirst({ where: { id: positionId, deletedAt: null } })
        : null,
      dto.userId
        ? this.prisma.user.findFirst({ where: { id: dto.userId, deletedAt: null } })
        : null,
    ]);
    if ((departmentId && !department) || (positionId && !position) || (dto.userId && !user)) {
      throw new NotFoundException('One or more referenced records were not found');
    }
    if (position?.departmentId && departmentId && position.departmentId !== departmentId) {
      throw new BadRequestException('The selected position belongs to a different department');
    }

    if (dto.managerId) {
      let managerId: string | null = dto.managerId;
      for (let depth = 0; managerId && depth < 100; depth += 1) {
        if (managerId === currentEmployeeId) {
          throw new ForbiddenException('Reporting lines cannot contain a cycle');
        }
        const manager: { managerId: string | null } | null = await this.prisma.employee.findFirst({
          where: { id: managerId, deletedAt: null },
          select: { managerId: true },
        });
        if (!manager) throw new NotFoundException('Manager not found');
        managerId = manager.managerId;
      }
      if (managerId) throw new BadRequestException('Reporting line is too deep to validate safely');
    }
  }
}
