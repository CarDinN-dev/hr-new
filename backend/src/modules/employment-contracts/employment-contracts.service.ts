import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmploymentContractDto } from './dto/create-employment-contract.dto';
import { QueryEmploymentContractsDto } from './dto/query-employment-contracts.dto';
import { UpdateEmploymentContractDto } from './dto/update-employment-contract.dto';

const contractInclude = {
  employee: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true },
  },
};

@Injectable()
export class EmploymentContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEmploymentContractDto) {
    await this.ensureEmployee(dto.employeeId);
    this.assertDateRange(dto.startDate, dto.endDate);
    return this.prisma.employmentContract.create({ data: dto, include: contractInclude });
  }

  async list(query: QueryEmploymentContractsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.contractType) filters.push({ contractType: query.contractType });
    if (query.status) filters.push({ status: query.status });

    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'startDate', 'endDate', 'salary', 'status'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: contractInclude,
    });
    const [data, total] = await Promise.all([
      this.prisma.employmentContract.findMany(args),
      this.prisma.employmentContract.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const contract = await this.prisma.employmentContract.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      include: contractInclude,
    });
    if (!contract) throw new NotFoundException('Employment contract not found');
    return contract;
  }

  async update(id: string, dto: UpdateEmploymentContractDto) {
    const contract = await this.ensureExists(id);
    this.assertDateRange(dto.startDate ?? contract.startDate, dto.endDate ?? contract.endDate ?? undefined);
    return this.prisma.employmentContract.update({ where: { id }, data: dto, include: contractInclude });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return softDelete(this.prisma.employmentContract, id, 'Employment contract');
  }

  private accessWhere(user: RequestUser) {
    if (hasHrAccess(user.role)) return {};
    if (!user.employeeId) return { employeeId: '__no_employee_profile__' };
    if (user.role === Role.MANAGER) {
      return { OR: [{ employeeId: user.employeeId }, { employee: { managerId: user.employeeId } }] };
    }
    return { employeeId: user.employeeId };
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private async ensureExists(id: string) {
    const contract = await this.prisma.employmentContract.findFirst({ where: { id, deletedAt: null } });
    if (!contract) throw new NotFoundException('Employment contract not found');
    return contract;
  }

  private assertDateRange(startDate: Date, endDate?: Date) {
    if (endDate && endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }
}
