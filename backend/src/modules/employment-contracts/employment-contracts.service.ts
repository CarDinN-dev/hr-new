import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AuditAction, Prisma } from '@prisma/client';
import { nonNegativeMoney } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmploymentContractDto } from './dto/create-employment-contract.dto';
import { QueryEmploymentContractsDto } from './dto/query-employment-contracts.dto';
import { UpdateEmploymentContractDto } from './dto/update-employment-contract.dto';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';

const contractInclude = {
  employee: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true },
  },
};

const contractSummarySelect = {
  id: true, employeeId: true, contractType: true, startDate: true, endDate: true, currency: true,
  workingHoursPerWeek: true, status: true, createdAt: true, updatedAt: true, deletedAt: true,
  employee: contractInclude.employee,
} satisfies Prisma.EmploymentContractSelect;

const contractDetailSelect = {
  ...contractSummarySelect,
  salary: true,
  terms: true,
} satisfies Prisma.EmploymentContractSelect;

@Injectable()
export class EmploymentContractsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreateEmploymentContractDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, dto.employeeId, { all: 'contract.hr.manage' });
    this.assertDateRange(dto.startDate, dto.endDate);
    return this.transaction(async (tx) => {
      const contract = await tx.employmentContract.create({ data: { ...dto, salary: nonNegativeMoney(dto.salary, 'salary') }, include: contractInclude });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'EmploymentContract', entityId: contract.id, summary: 'Employment contract created', subjectEmployeeId: dto.employeeId });
      return contract;
    });
  }

  async list(query: QueryEmploymentContractsDto, user: RequestUser) {
    const filters: Prisma.EmploymentContractWhereInput[] = [await this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.contractType) filters.push({ contractType: query.contractType });
    if (query.status) filters.push({ status: query.status });

    const canSortSalary = this.authorization.has(user, 'contract.hr.manage');
    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: canSortSalary ? ['createdAt', 'startDate', 'endDate', 'salary', 'status'] : ['createdAt', 'startDate', 'endDate', 'status'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      select: contractSummarySelect,
    });
    const [data, total] = await Promise.all([
      this.prisma.employmentContract.findMany(args),
      this.prisma.employmentContract.count({ where: args.where }),
    ]);
    const sensitiveIds = data
      .filter((contract) => this.canReadSensitiveContract(user, contract.employeeId))
      .map((contract) => contract.id);
    const sensitive = sensitiveIds.length
      ? await this.prisma.employmentContract.findMany({
        where: { id: { in: sensitiveIds }, deletedAt: null },
        select: { id: true, salary: true, terms: true },
      })
      : [];
    const sensitiveById = new Map(sensitive.map((contract) => [contract.id, contract]));
    return {
      data: data.map((contract) => ({ ...contract, ...sensitiveById.get(contract.id) })),
      meta: paginationMeta(total, page, limit),
    };
  }

  async findById(id: string, user: RequestUser) {
    const scope = await this.accessWhere(user);
    const target = await this.prisma.employmentContract.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, scope] },
      select: { employeeId: true },
    });
    if (!target) throw new NotFoundException('Employment contract not found');
    const contract = await this.prisma.employmentContract.findFirst({
      where: { id, deletedAt: null },
      select: this.canReadSensitiveContract(user, target.employeeId) ? contractDetailSelect : contractSummarySelect,
    });
    if (!contract) throw new NotFoundException('Employment contract not found');
    return contract;
  }

  async update(id: string, dto: UpdateEmploymentContractDto, user: RequestUser) {
    const contract = await this.ensureExists(id);
    await this.authorization.assertEmployeeScope(user, contract.employeeId, { all: 'contract.hr.manage' });
    this.assertDateRange(dto.startDate ?? contract.startDate, dto.endDate ?? contract.endDate ?? undefined);
    return this.transaction(async (tx) => {
      const updated = await tx.employmentContract.update({ where: { id }, data: { ...dto, salary: dto.salary === undefined ? undefined : nonNegativeMoney(dto.salary, 'salary') }, include: contractInclude });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmploymentContract', entityId: id, summary: 'Employment contract updated', subjectEmployeeId: contract.employeeId });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    const contract = await this.ensureExists(id);
    await this.authorization.assertEmployeeScope(user, contract.employeeId, { all: 'contract.hr.manage' });
    return this.transaction(async (tx) => {
      const removed = await tx.employmentContract.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'EmploymentContract', entityId: id, summary: 'Employment contract archived', subjectEmployeeId: contract.employeeId });
      return removed;
    });
  }

  private async accessWhere(user: RequestUser): Promise<Prisma.EmploymentContractWhereInput> {
    const scopes: Prisma.EmploymentContractWhereInput[] = [];
    for (const permission of ['contract.hr.manage', 'contract.read_all'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'contract.self.read', AccessScopeType.SELF, user.employeeId)) {
      scopes.push({ employeeId: user.employeeId });
    }
    if (user.employeeId && this.authorization.has(user, 'contract.team.read')) {
      const ids = (await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } }))
        .map(({ id }) => id)
        .filter((employeeId) => this.authorization.permissionAllowedForScope(user, 'contract.team.read', AccessScopeType.DIRECT_REPORTS, employeeId));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    if (user.employeeId && this.authorization.has(user, 'contract.management.read')) {
      const ids = (await this.authorization.managementTreeEmployeeIds(user.employeeId))
        .filter((employeeId) => this.authorization.permissionAllowedForScope(user, 'contract.management.read', AccessScopeType.MANAGEMENT_TREE, employeeId));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    return scopes.length ? { OR: scopes } : { employeeId: '__no_contract_scope__' };
  }

  private canReadSensitiveContract(user: RequestUser, employeeId: string) {
    return (employeeId === user.employeeId
      && this.authorization.permissionAllowedForScope(user, 'contract.self.read', AccessScopeType.SELF, employeeId))
      || this.authorization.permissionAllowedForScope(user, 'contract.hr.manage', AccessScopeType.ALL_EMPLOYEES, employeeId);
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

  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
      }
    }
    throw new ConflictException('Employment contract changed in another request. Try again.');
  }
}
