import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AuditAction, EmploymentStatus, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { AuditService } from '../audit/audit.service';
import { nonNegativeMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { UpdateHrSensitiveDetailsDto, UpdatePayrollBankDto, UpdateSelfBankDto, UpdateSelfBasicProfileDto } from './dto/self-employee.dto';
import { AuthorizationService } from '../authorization/authorization.service';
import { randomUUID } from 'crypto';
import { ImportEmployeesDto, ImportSalaryRecordDto } from './dto/import-employees.dto';

const managerSummarySelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, email: true,
} satisfies Prisma.EmployeeSelect;

const employeeSummarySelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, email: true,
  phone: true, hireDate: true, employmentStatus: true, departmentId: true, positionId: true,
  managerId: true, photo: true, version: true, createdAt: true, updatedAt: true,
  department: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, title: true, code: true, level: true } },
  manager: {
    select: managerSummarySelect,
  },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly authorization: AuthorizationService) {}

  async create(dto: CreateEmployeeDto, user: RequestUser) {
    if (!this.authorization.permissionAllowedForScope(user, 'employee.hr.create', AccessScopeType.ALL_EMPLOYEES)) {
      throw new ForbiddenException('Insufficient permission');
    }
    await this.validateRelations(dto);
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: { ...dto, photo: dto.photo || null, salary: ZERO_MONEY },
        select: this.projection(user, false),
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Employee', entityId: employee.id, summary: 'Employee created' });
      return employee;
    });
  }

  async importEmployees(dto: ImportEmployeesDto, user: RequestUser) {
    if (!this.authorization.permissionAllowedForScope(user, 'import.run', AccessScopeType.ALL_SYSTEM)) throw new ForbiddenException('Insufficient permission');
    if (!this.authorization.permissionAllowedForScope(user, 'employee.hr.create', AccessScopeType.ALL_EMPLOYEES)) throw new ForbiddenException('Insufficient permission');
    const rows = dto.rows.map((row) => ({ ...row, employeeCode: row.employeeCode.trim(), email: row.email.trim().toLowerCase() }));
    const codes = rows.map((row) => row.employeeCode);
    const emails = rows.map((row) => row.email);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('Employee codes must be unique within an import');
    if (new Set(emails).size !== emails.length) throw new BadRequestException('Employee emails must be unique within an import');
    const managerCodes = rows.map((row) => row.managerEmployeeCode?.trim()).filter((code): code is string => Boolean(code));
    const existing = await this.prisma.employee.findMany({
      where: { OR: [{ employeeCode: { in: [...new Set([...codes, ...managerCodes])] } }, { email: { in: emails } }] },
      select: { id: true, employeeCode: true, email: true, managerId: true, deletedAt: true },
    });
    const existingByCode = new Map(existing.map((employee) => [employee.employeeCode, employee]));
    for (const employee of existing) {
      const importing = rows.find((row) => row.employeeCode === employee.employeeCode);
      if (emails.includes(employee.email.toLowerCase()) && importing?.email !== employee.email.toLowerCase()) throw new ConflictException('An imported email belongs to a different employee code');
    }
    const prepared = rows.map((row) => ({ ...row, id: existingByCode.get(row.employeeCode)?.id ?? randomUUID() }));
    const preparedByCode = new Map(prepared.map((row) => [row.employeeCode, row]));
    for (const row of prepared) {
      if (row.managerEmployeeCode) {
        const manager = preparedByCode.get(row.managerEmployeeCode.trim()) ?? existingByCode.get(row.managerEmployeeCode.trim());
        if (!manager || ('deletedAt' in manager && manager.deletedAt)) throw new NotFoundException(`Manager ${row.managerEmployeeCode} was not found`);
        row.managerId = manager.id;
      }
    }
    const departmentIds = [...new Set(prepared.map((row) => row.departmentId).filter((id): id is string => Boolean(id)))];
    const positionIds = [...new Set(prepared.map((row) => row.positionId).filter((id): id is string => Boolean(id)))];
    const managerIds = [...new Set(prepared.map((row) => row.managerId).filter((id): id is string => Boolean(id)))];
    const [departments, positions, employees] = await Promise.all([
      this.prisma.department.findMany({ where: { id: { in: departmentIds }, deletedAt: null }, select: { id: true } }),
      this.prisma.jobPosition.findMany({ where: { id: { in: positionIds }, deletedAt: null }, select: { id: true, departmentId: true } }),
      this.prisma.employee.findMany({ where: { deletedAt: null }, select: { id: true, managerId: true } }),
    ]);
    if (departments.length !== departmentIds.length) throw new NotFoundException('One or more departments were not found');
    if (positions.length !== positionIds.length) throw new NotFoundException('One or more positions were not found');
    const activeEmployeeIds = new Set([...employees.map((employee) => employee.id), ...prepared.map((row) => row.id)]);
    if (managerIds.some((id) => !activeEmployeeIds.has(id))) throw new NotFoundException('One or more managers were not found');
    const positionById = new Map(positions.map((position) => [position.id, position]));
    for (const row of prepared) {
      const position = row.positionId ? positionById.get(row.positionId) : undefined;
      if (position?.departmentId && row.departmentId && position.departmentId !== row.departmentId) throw new BadRequestException(`Position and department do not match for ${row.employeeCode}`);
    }
    const managerById = new Map(employees.map((employee) => [employee.id, employee.managerId]));
    for (const row of prepared) managerById.set(row.id, row.managerId ?? null);
    for (const row of prepared) {
      const visited = new Set<string>([row.id]);
      let managerId = row.managerId ?? null;
      for (let depth = 0; managerId && depth < 32; depth += 1) {
        if (visited.has(managerId)) throw new BadRequestException(`Reporting line cycle found for ${row.employeeCode}`);
        visited.add(managerId);
        managerId = managerById.get(managerId) ?? null;
      }
      if (managerId) throw new BadRequestException(`Reporting line is too deep for ${row.employeeCode}`);
    }

    const salaryRecords = await this.prisma.salaryRecord.findMany({ where: { employeeId: { in: prepared.map((row) => row.id) }, deletedAt: null } });
    const salaryByEmployee = new Map<string, typeof salaryRecords>();
    for (const record of salaryRecords) salaryByEmployee.set(record.employeeId, [...(salaryByEmployee.get(record.employeeId) ?? []), record]);
    const salaryData = new Map<string, ReturnType<EmployeesService['importSalaryData']> & { id?: string }>();
    for (const row of prepared) if (row.salaryRecord) {
      const data = this.importSalaryData(row.salaryRecord);
      const sameStart = (salaryByEmployee.get(row.id) ?? []).find((record) => record.effectiveFrom.getTime() === data.effectiveFrom.getTime());
      const overlap = (salaryByEmployee.get(row.id) ?? []).find((record) => record.id !== sameStart?.id && record.effectiveFrom <= (data.effectiveTo ?? new Date(8_640_000_000_000_000)) && (!record.effectiveTo || record.effectiveTo >= data.effectiveFrom));
      if (overlap) throw new ConflictException(`Salary dates overlap for ${row.employeeCode}`);
      salaryData.set(row.id, { ...data, id: sameStart?.id });
    }
    const credentialIds = prepared.flatMap((row) => row.details?.credentials?.map((credential) => credential.id).filter((id): id is string => Boolean(id)) ?? []);
    const educationIds = prepared.flatMap((row) => row.details?.education?.map((education) => education.id).filter((id): id is string => Boolean(id)) ?? []);
    const [credentials, education] = await Promise.all([
      this.prisma.employeeCredential.findMany({ where: { id: { in: credentialIds } }, select: { id: true, employeeId: true } }),
      this.prisma.employeeEducation.findMany({ where: { id: { in: educationIds } }, select: { id: true, employeeId: true } }),
    ]);
    const credentialOwner = new Map(credentials.map((record) => [record.id, record.employeeId]));
    const educationOwner = new Map(education.map((record) => [record.id, record.employeeId]));
    for (const row of prepared) {
      const types = row.details?.credentials?.map((credential) => credential.type.trim()) ?? [];
      if (new Set(types).size !== types.length) throw new BadRequestException(`Credential types must be unique for ${row.employeeCode}`);
      if (row.details?.credentials?.some((credential) => credential.id && credentialOwner.get(credential.id) !== row.id)) throw new BadRequestException(`Credential ownership mismatch for ${row.employeeCode}`);
      if (row.details?.education?.some((item) => item.id && educationOwner.get(item.id) !== row.id)) throw new BadRequestException(`Education ownership mismatch for ${row.employeeCode}`);
    }

    return this.prisma.$transaction(async (tx) => {
      for (let offset = 0; offset < prepared.length; offset += 4_000) {
        const chunk = prepared.slice(offset, offset + 4_000);
        const values = chunk.map((row) => Prisma.sql`(
          ${row.id}, ${row.employeeCode}, ${row.firstName.trim()}, ${row.lastName.trim()}, ${row.email}, ${row.phone ?? null},
          ${row.hireDate}, ${row.employmentStatus ?? EmploymentStatus.ACTIVE}::"EmploymentStatus",
          ${row.departmentId ?? null}, ${row.positionId ?? null}, ${row.managerId ?? null}, ${row.photo || null},
          ${ZERO_MONEY}, 1, NOW(), NOW(), NULL
        )`);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "Employee" (
            "id", "employeeCode", "firstName", "lastName", "email", "phone", "hireDate", "employmentStatus",
            "departmentId", "positionId", "managerId", "photo", "salary", "version", "createdAt", "updatedAt", "deletedAt"
          ) VALUES ${Prisma.join(values)}
          ON CONFLICT ("employeeCode") DO UPDATE SET
            "firstName" = EXCLUDED."firstName", "lastName" = EXCLUDED."lastName", "email" = EXCLUDED."email",
            "phone" = EXCLUDED."phone", "hireDate" = EXCLUDED."hireDate", "employmentStatus" = EXCLUDED."employmentStatus",
            "departmentId" = EXCLUDED."departmentId", "positionId" = EXCLUDED."positionId", "managerId" = EXCLUDED."managerId",
            "photo" = EXCLUDED."photo", "deletedAt" = NULL, "version" = "Employee"."version" + 1, "updatedAt" = NOW()
        `);
      }
      for (const row of prepared) {
        if (row.details) await this.writeDetails(tx, row.id, row.details);
        if (row.bank) await tx.employeeBankAccount.upsert({ where: { employeeId: row.id }, create: { employeeId: row.id, ...row.bank }, update: { ...row.bank, version: { increment: 1 } } });
        const salary = salaryData.get(row.id);
        if (salary) {
          const { id: salaryId, ...data } = salary;
          if (salaryId) await tx.salaryRecord.update({ where: { id: salaryId }, data: { ...data, deletedAt: null, version: { increment: 1 } } });
          else await tx.salaryRecord.create({ data: { employeeId: row.id, ...data } });
        }
      }
      await this.audit.record(tx, user, { action: AuditAction.IMPORT, entityType: 'Employee', summary: 'Atomic employee import completed', metadata: { rowCount: prepared.length } });
      const imported = await tx.employee.findMany({ where: { id: { in: prepared.map((row) => row.id) } }, select: employeeSummarySelect });
      const sourceIds = new Map(prepared.filter((row) => row.sourceId).map((row) => [row.id, row.sourceId!]));
      return { imported: imported.length, data: imported, idMap: imported.filter((employee) => sourceIds.has(employee.id)).map((employee) => ({ sourceId: sourceIds.get(employee.id), id: employee.id })) };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(query: QueryEmployeesDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [await this.accessWhere(user)];

    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.positionId) filters.push({ positionId: query.positionId });
    if (query.managerId) filters.push({ managerId: query.managerId });
    if (query.employmentStatus) filters.push({ employmentStatus: query.employmentStatus });

    const { page, limit, ...args } = listArgs(query, {
      searchFields: ['employeeCode', 'firstName', 'lastName', 'email', 'phone'],
      allowedSortFields: ['createdAt', 'employeeCode', 'firstName', 'lastName', 'hireDate', ...(user.permissions.includes('payroll.read_compensation') ? ['salary'] : [])],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      select: this.projection(user, false),
    });

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany(args),
      this.prisma.employee.count({ where: args.where }),
    ]);

    if (this.includesSensitiveFields(user)) {
      await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'Employee', summary: 'Sensitive employee records viewed' });
    }

    return {
      data,
      meta: paginationMeta(total, page, limit),
    };
  }

  async findById(id: string, user: RequestUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, await this.accessWhere(user)] },
      select: this.projection(user, id === user.employeeId, id),
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    if (this.includesSensitiveFields(user) || id === user.employeeId) {
      await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'Employee', entityId: id, summary: 'Employee record viewed' });
    }

    return employee;
  }

  async getMyProfile(user: RequestUser) {
    if (!user.employeeId) {
      throw new NotFoundException('No employee profile is linked to this user');
    }

    return this.findById(user.employeeId, user);
  }

  async updateSelfBasic(dto: UpdateSelfBasicProfileDto, user: RequestUser) {
    if (!user.employeeId) throw new NotFoundException('No employee profile is linked to this user');
    if (!this.authorization.permissionAllowedForScope(user, 'employee.self.update_basic', AccessScopeType.SELF, user.employeeId)) throw new NotFoundException('Employee not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id: user.employeeId! },
        data: { ...dto, version: { increment: 1 } },
        select: this.projection(user, true, user.employeeId ?? undefined),
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Employee', entityId: user.employeeId!, summary: 'Self-service profile updated' });
      return updated;
    });
  }

  async updateSelfBank(dto: UpdateSelfBankDto, user: RequestUser) {
    if (!user.employeeId) throw new NotFoundException('No employee profile is linked to this user');
    if (!this.authorization.permissionAllowedForScope(user, 'employee.self.update_bank', AccessScopeType.SELF, user.employeeId)) throw new NotFoundException('Employee not found');
    return this.prisma.$transaction(async (tx) => {
      const bank = await tx.employeeBankAccount.upsert({
        where: { employeeId: user.employeeId! },
        create: { employeeId: user.employeeId!, ...dto },
        update: { ...dto, version: { increment: 1 } },
        select: { employeeId: true, bankCode: true, iban: true, accountNumber: true, version: true, updatedAt: true },
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmployeeBankAccount', entityId: user.employeeId!, summary: 'Self-service bank details updated' });
      return bank;
    });
  }

  async updatePayrollBank(id: string, dto: UpdatePayrollBankDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, id, { all: 'payroll.update_bank' });
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const bank = await tx.employeeBankAccount.upsert({
        where: { employeeId: id },
        create: { employeeId: id, ...dto },
        update: { ...dto, version: { increment: 1 } },
        select: { employeeId: true, bankCode: true, iban: true, accountNumber: true, version: true, updatedAt: true },
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmployeeBankAccount', entityId: id, summary: 'Payroll bank details updated' });
      return bank;
    });
  }

  async update(id: string, dto: UpdateEmployeeDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, id, { all: 'employee.hr.update' });
    const employee = await this.ensureExists(id);
    await this.validateRelations(dto, id, employee);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: { ...dto, photo: dto.photo === undefined ? undefined : dto.photo || null, version: { increment: 1 } },
        select: this.projection(user, id === user.employeeId, id),
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Employee', entityId: id, summary: 'Employee updated' });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, id, { all: 'employee.hr.terminate' });
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
        data: { employmentStatus: EmploymentStatus.TERMINATED, deletedAt: new Date(), version: { increment: 1 } },
      });
      if (employee.userId) {
        await tx.user.update({
          where: { id: employee.userId },
          data: { isActive: false, authorizationVersion: { increment: 1 } },
        });
        await tx.authSession.updateMany({ where: { userId: employee.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Employee', entityId: id, summary: 'Employee archived' });
      return removed;
    });
  }

  async updateDetails(id: string, dto: UpdateHrSensitiveDetailsDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, id, { all: 'employee.hr.update' });
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      await this.writeDetails(tx, id, dto);
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmployeeDetails', entityId: id, summary: 'Employee profile details updated' });
      return tx.employee.findUniqueOrThrow({ where: { id }, select: this.projection(user, id === user.employeeId, id) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async writeDetails(tx: Prisma.TransactionClient, id: string, dto: UpdateHrSensitiveDetailsDto) {
    if (dto.dateOfBirth !== undefined || dto.gender !== undefined || dto.address !== undefined || dto.emergencyContactName !== undefined || dto.emergencyContactPhone !== undefined) {
      await tx.employee.update({
        where: { id },
        data: {
          dateOfBirth: dto.dateOfBirth,
          gender: dto.gender,
          address: dto.address,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          version: { increment: 1 },
        },
      });
    }
    if (dto.profile) {
      const profile = { ...dto.profile };
      await tx.employeeProfile.upsert({ where: { employeeId: id }, create: { employeeId: id, ...profile }, update: { ...profile, version: { increment: 1 } } });
    }
    if (dto.benefits) {
      const benefits = {
        ...dto.benefits,
        travelCost: dto.benefits.travelCost === undefined ? undefined : nonNegativeMoney(dto.benefits.travelCost, 'travelCost'),
        ticketBalancePercent: dto.benefits.ticketBalancePercent === undefined ? undefined : nonNegativeMoney(dto.benefits.ticketBalancePercent, 'ticketBalancePercent'),
      };
      await tx.employeeBenefitProfile.upsert({ where: { employeeId: id }, create: { employeeId: id, ...benefits }, update: { ...benefits, version: { increment: 1 } } });
    }
    if (dto.credentials !== undefined) {
      const types = dto.credentials.map((credential) => credential.type.trim());
      if (new Set(types).size !== types.length) throw new BadRequestException('Credential types must be unique');
      await tx.employeeCredential.updateMany({ where: { employeeId: id, type: { notIn: types }, deletedAt: null }, data: { deletedAt: new Date() } });
      for (const credential of dto.credentials) {
        const { id: credentialId, type: rawType, ...data } = credential;
        const type = rawType.trim();
        if (credentialId) {
          const matching = await tx.employeeCredential.findFirst({ where: { id: credentialId, employeeId: id } });
          if (!matching || matching.type !== type) throw new BadRequestException('Credential identity and type do not match');
        }
        await tx.employeeCredential.upsert({ where: { employeeId_type: { employeeId: id, type } }, create: { employeeId: id, type, ...data }, update: { ...data, deletedAt: null } });
      }
    }
    if (dto.education !== undefined) {
      const retainedIds = new Set<string>();
      for (const education of dto.education) {
        const qualification = education.qualification.trim();
        if (education.id) {
          const updated = await tx.employeeEducation.updateMany({ where: { id: education.id, employeeId: id }, data: { qualification, yearOfPassing: education.yearOfPassing, deletedAt: null } });
          if (updated.count !== 1) throw new BadRequestException('Education record does not belong to this employee');
          retainedIds.add(education.id);
        } else {
          const created = await tx.employeeEducation.create({ data: { employeeId: id, qualification, yearOfPassing: education.yearOfPassing } });
          retainedIds.add(created.id);
        }
      }
      await tx.employeeEducation.updateMany({ where: { employeeId: id, id: { notIn: [...retainedIds] }, deletedAt: null }, data: { deletedAt: new Date() } });
    }
  }

  private importSalaryData(dto: ImportSalaryRecordDto) {
    if (dto.effectiveTo && dto.effectiveTo < dto.effectiveFrom) {
      throw new BadRequestException('Salary effectiveTo must not be before effectiveFrom');
    }
    const componentSupplied = [dto.housingAllowance, dto.foodAllowance, dto.mobileAllowance, dto.specialAllowance]
      .some((value) => value !== undefined);
    const component = (value: string | undefined, field: string) =>
      nonNegativeMoney(value ?? 0, field, '1000000000');
    let housingAllowance = component(dto.housingAllowance, 'housingAllowance');
    let foodAllowance = component(dto.foodAllowance, 'foodAllowance');
    let mobileAllowance = component(dto.mobileAllowance, 'mobileAllowance');
    let specialAllowance = component(dto.specialAllowance, 'specialAllowance');
    if (dto.allowances !== undefined && !componentSupplied) {
      housingAllowance = nonNegativeMoney(dto.allowances, 'allowances', '1000000000');
      foodAllowance = ZERO_MONEY;
      mobileAllowance = ZERO_MONEY;
      specialAllowance = ZERO_MONEY;
    }
    const allowances = sumMoney([housingAllowance, foodAllowance, mobileAllowance, specialAllowance]);
    const overtimeAmount = nonNegativeMoney(dto.overtimeAmount ?? dto.bonuses ?? 0, 'overtimeAmount', '1000000000');
    return {
      baseSalary: nonNegativeMoney(dto.baseSalary, 'baseSalary', '1000000000'),
      allowances,
      housingAllowance,
      foodAllowance,
      mobileAllowance,
      specialAllowance,
      deductions: nonNegativeMoney(dto.deductions ?? 0, 'deductions', '1000000000'),
      bonuses: nonNegativeMoney(dto.bonuses ?? overtimeAmount, 'bonuses', '1000000000'),
      overtimeAmount,
      taxRate: nonNegativeMoney(dto.taxRate ?? 0, 'taxRate', '100'),
      effectiveFrom: dto.effectiveFrom,
      effectiveTo: dto.effectiveTo,
    };
  }

  async ensureExists(id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  private async accessWhere(user: RequestUser): Promise<Prisma.EmployeeWhereInput> {
    const scopes: Prisma.EmployeeWhereInput[] = [];
    for (const permission of ['employee.read_all', 'employee.hr.read'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ id: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ id: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'employee.self.read', AccessScopeType.SELF, user.employeeId)) scopes.push({ id: user.employeeId });
    if (user.employeeId && this.authorization.has(user, 'employee.team.read')) {
      const directReports = await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } });
      const ids = directReports.map((employee) => employee.id).filter((id) => this.authorization.permissionAllowedForScope(user, 'employee.team.read', AccessScopeType.DIRECT_REPORTS, id));
      if (ids.length) scopes.push({ id: { in: ids } });
    }
    if (user.employeeId && this.authorization.has(user, 'employee.management.read')) {
      const ids = (await this.authorization.managementTreeEmployeeIds(user.employeeId)).filter((id) => this.authorization.permissionAllowedForScope(user, 'employee.management.read', AccessScopeType.MANAGEMENT_TREE, id));
      if (ids.length) scopes.push({ id: { in: ids } });
    }
    return scopes.length ? { OR: scopes } : { id: '__no_employee_scope__' };
  }

  private projection(user: RequestUser, self: boolean, employeeId?: string): Prisma.EmployeeSelect {
    const select: Prisma.EmployeeSelect = { ...employeeSummarySelect };
    if (self && user.permissions.includes('employee.self.read')) {
      Object.assign(select, {
        dateOfBirth: true, gender: true, address: true, emergencyContactName: true, emergencyContactPhone: true,
      });
    }
    const sensitiveRule = this.authorization.scopeRule(user, 'employee.hr.read_sensitive', AccessScopeType.ALL_EMPLOYEES);
    if (employeeId ? this.authorization.permissionAllowedForScope(user, 'employee.hr.read_sensitive', AccessScopeType.ALL_EMPLOYEES, employeeId) : sensitiveRule.unrestricted && sensitiveRule.excludeIds.length === 0) {
      Object.assign(select, {
        dateOfBirth: true, gender: true, address: true, emergencyContactName: true, emergencyContactPhone: true,
        profile: true, benefits: true,
        credentials: { where: { deletedAt: null } }, education: { where: { deletedAt: null } },
      });
    }
    const compensationRule = this.authorization.scopeRule(user, 'payroll.read_compensation', AccessScopeType.ALL_EMPLOYEES);
    if ((employeeId ? this.authorization.permissionAllowedForScope(user, 'payroll.read_compensation', AccessScopeType.ALL_EMPLOYEES, employeeId) : compensationRule.unrestricted && compensationRule.excludeIds.length === 0) || (self && employeeId && this.authorization.permissionAllowedForScope(user, 'employee.self.read_compensation', AccessScopeType.SELF, employeeId))) {
      Object.assign(select, { salary: true, salaryRecords: { where: { deletedAt: null }, orderBy: { effectiveFrom: 'desc' } } });
    }
    const bankRule = this.authorization.scopeRule(user, 'payroll.read_bank', AccessScopeType.ALL_EMPLOYEES);
    if ((employeeId ? this.authorization.permissionAllowedForScope(user, 'payroll.read_bank', AccessScopeType.ALL_EMPLOYEES, employeeId) : bankRule.unrestricted && bankRule.excludeIds.length === 0) || (self && employeeId && this.authorization.permissionAllowedForScope(user, 'employee.self.read_bank', AccessScopeType.SELF, employeeId))) {
      Object.assign(select, { bankAccount: true });
    }
    return select;
  }

  private includesSensitiveFields(user: RequestUser) {
    return user.permissions.some((permission) => [
      'employee.hr.read_sensitive', 'payroll.read_compensation', 'payroll.read_bank',
    ].includes(permission));
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
    const [department, position] = await Promise.all([
      departmentId
        ? this.prisma.department.findFirst({ where: { id: departmentId, deletedAt: null } })
        : null,
      positionId
        ? this.prisma.jobPosition.findFirst({ where: { id: positionId, deletedAt: null } })
        : null,
    ]);
    if ((departmentId && !department) || (positionId && !position)) {
      throw new NotFoundException('One or more referenced records were not found');
    }
    if (position?.departmentId && departmentId && position.departmentId !== departmentId) {
      throw new BadRequestException('The selected position belongs to a different department');
    }

    if (dto.managerId) {
      let managerId: string | null = dto.managerId;
      for (let depth = 0; managerId && depth < 32; depth += 1) {
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
