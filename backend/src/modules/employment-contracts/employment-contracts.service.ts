import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { hasPermission } from '../../common/authorization';
import { nonNegativeMoney } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmploymentContractDto } from './dto/create-employment-contract.dto';
import { QueryEmploymentContractsDto } from './dto/query-employment-contracts.dto';
import { UpdateEmploymentContractDto } from './dto/update-employment-contract.dto';
import { AuditService } from '../audit/audit.service';

const contractInclude = {
  employee: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true },
  },
};

const contractSummarySelect = {
  id: true, employeeId: true, contractType: true, startDate: true, endDate: true, currency: true,
  workingHoursPerWeek: true, status: true, terms: true, createdAt: true, updatedAt: true, deletedAt: true,
  employee: contractInclude.employee,
} satisfies Prisma.EmploymentContractSelect;

@Injectable()
export class EmploymentContractsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateEmploymentContractDto, user: RequestUser) {
    await this.ensureEmployee(dto.employeeId);
    this.assertDateRange(dto.startDate, dto.endDate);
    return this.prisma.$transaction(async (tx) => {
      const contract = await tx.employmentContract.create({ data: { ...dto, salary: nonNegativeMoney(dto.salary, 'salary') }, include: contractInclude });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'EmploymentContract', entityId: contract.id, summary: 'Employment contract created' });
      return contract;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(query: QueryEmploymentContractsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.contractType) filters.push({ contractType: query.contractType });
    if (query.status) filters.push({ status: query.status });

    const canReadSalary = hasPermission(user, 'contract.hr.manage');
    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: canReadSalary ? ['createdAt', 'startDate', 'endDate', 'salary', 'status'] : ['createdAt', 'startDate', 'endDate', 'status'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      select: canReadSalary ? { ...contractSummarySelect, salary: true } : contractSummarySelect,
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
      select: hasPermission(user, 'contract.hr.manage') || user.employeeId === (await this.contractEmployeeId(id))
        ? { ...contractSummarySelect, salary: true }
        : contractSummarySelect,
    });
    if (!contract) throw new NotFoundException('Employment contract not found');
    return contract;
  }

  async update(id: string, dto: UpdateEmploymentContractDto, user: RequestUser) {
    const contract = await this.ensureExists(id);
    this.assertDateRange(dto.startDate ?? contract.startDate, dto.endDate ?? contract.endDate ?? undefined);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employmentContract.update({ where: { id }, data: { ...dto, salary: dto.salary === undefined ? undefined : nonNegativeMoney(dto.salary, 'salary') }, include: contractInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmploymentContract', entityId: id, summary: 'Employment contract updated' });
      return updated;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async remove(id: string, user: RequestUser) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.employmentContract.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'EmploymentContract', entityId: id, summary: 'Employment contract archived' });
      return removed;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private accessWhere(user: RequestUser) {
    if (hasPermission(user, 'contract.hr.manage')) return {};
    const scopes: Prisma.EmploymentContractWhereInput[] = [];
    if (user.employeeId && hasPermission(user, 'contract.self.read')) scopes.push({ employeeId: user.employeeId });
    if (user.employeeId && hasPermission(user, 'contract.team.read')) scopes.push({ employee: { managerId: user.employeeId } });
    if (hasPermission(user, 'contract.team.read') && user.departmentScopeIds.length) {
      scopes.push({ employee: { departmentId: { in: user.departmentScopeIds } } });
    }
    return scopes.length ? { OR: scopes } : { employeeId: '__no_contract_scope__' };
  }

  private async contractEmployeeId(id: string) {
    const contract = await this.prisma.employmentContract.findFirst({ where: { id, deletedAt: null }, select: { employeeId: true } });
    return contract?.employeeId;
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
