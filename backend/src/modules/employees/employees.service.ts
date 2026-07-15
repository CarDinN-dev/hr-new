import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateEmployeeDetailsDto } from './dto/update-employee-details.dto';
import { AuditService } from '../audit/audit.service';
import { money, nonNegativeMoney } from '../../common/money';

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
  profile: true,
  bankAccount: true,
  benefits: true,
  credentials: { where: { deletedAt: null } },
  education: { where: { deletedAt: null } },
};

const employeeIncludeWithSalary = { ...employeeInclude, salaryRecords: { where: { deletedAt: null }, orderBy: { effectiveFrom: 'desc' as const } } };

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateEmployeeDto, user: RequestUser) {
    await this.validateRelations(dto);
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: { ...dto, salary: nonNegativeMoney(dto.salary, 'salary', '1000000000') },
        include: employeeIncludeWithSalary,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Employee', entityId: employee.id, summary: 'Employee created' });
      return employee;
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
      include: hasHrAccess(user.role) ? employeeIncludeWithSalary : employeeInclude,
    });

    const [data, total] = await Promise.all([
      this.prisma.employee.findMany(args),
      this.prisma.employee.count({ where: args.where }),
    ]);

    return {
      data: hasHrAccess(user.role) ? data : data.map((employee) => this.withoutSalary(employee)),
      meta: paginationMeta(total, page, limit),
    };
  }

  async findById(id: string, user: RequestUser) {
    const employee = await this.prisma.employee.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      include: hasHrAccess(user.role) ? employeeIncludeWithSalary : employeeInclude,
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    return hasHrAccess(user.role) ? employee : this.withoutSalary(employee);
  }

  async getMyProfile(user: RequestUser) {
    if (!user.employeeId) {
      throw new NotFoundException('No employee profile is linked to this user');
    }

    return this.findById(user.employeeId, user);
  }

  async update(id: string, dto: UpdateEmployeeDto, user: RequestUser) {
    const employee = await this.ensureExists(id);
    await this.validateRelations(dto, id, employee);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: { ...dto, salary: dto.salary === undefined ? undefined : nonNegativeMoney(dto.salary, 'salary', '1000000000'), version: { increment: 1 } },
        include: employeeIncludeWithSalary,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Employee', entityId: id, summary: 'Employee updated' });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
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
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Employee', entityId: id, summary: 'Employee archived' });
      return removed;
    });
  }

  async updateDetails(id: string, dto: UpdateEmployeeDetailsDto, user: RequestUser) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      if (dto.profile) {
        const source = dto.profile;
        const profile = {
          employeeCategory: this.text(source.employeeCategory), workShift: this.text(source.workShift), company: this.text(source.company),
          sponsorName: this.text(source.sponsorName), wpsSponsor: this.text(source.wpsSponsor), gradeBand: this.text(source.gradeBand), familyStatus: this.text(source.familyStatus),
          leavePolicy: this.text(source.leavePolicy), lastRejoinDate: this.date(source.lastRejoinDate), businessUnit: this.text(source.businessUnit),
          workingCompanyName: this.text(source.workingCompanyName), costCentre: this.text(source.costCentre), nationality: this.text(source.nationality),
          residenceProfession: this.text(source.residenceProfession), visaType: this.text(source.visaType), hireType: this.text(source.hireType),
          confirmationDate: this.date(source.confirmationDate), esbDate: this.date(source.esbDate), maritalStatus: this.text(source.maritalStatus),
          officeMobile: this.text(source.officeMobile), personalMobile: this.text(source.personalMobile), dependents: this.integer(source.dependents), bloodGroup: this.text(source.bloodGroup),
          localBuilding: this.text(source.localBuilding), localStreet: this.text(source.localStreet), localZone: this.text(source.localZone),
          internationalApartment: this.text(source.internationalApartment), internationalBuilding: this.text(source.internationalBuilding), internationalFloor: this.text(source.internationalFloor),
          internationalStreet: this.text(source.internationalStreet), internationalState: this.text(source.internationalState), internationalCountry: this.text(source.internationalCountry), internationalZipCode: this.text(source.internationalZipCode),
          emergencyRelationship: this.text(source.emergencyRelationship), salaryPayType: this.text(source.salaryPayType), officeFileNumber: this.text(source.officeFileNumber), accessCardNumber: this.text(source.accessCardNumber),
        };
        await tx.employeeProfile.upsert({ where: { employeeId: id }, create: { employeeId: id, ...profile }, update: { ...profile, version: { increment: 1 } } });
      }
      if (dto.bankAccount) {
        const bank = { bankCode: this.text(dto.bankAccount.bankCode), iban: this.text(dto.bankAccount.iban), accountNumber: this.text(dto.bankAccount.accountNumber) };
        await tx.employeeBankAccount.upsert({ where: { employeeId: id }, create: { employeeId: id, ...bank }, update: { ...bank, version: { increment: 1 } } });
      }
      if (dto.benefits) {
        const source = dto.benefits;
        const benefits = {
          travelSector: this.text(source.travelSector), travelCost: nonNegativeMoney(this.decimalInput(source.travelCost), 'travelCost'),
          employeeTicketsPerYear: this.integer(source.employeeTicketsPerYear) ?? 0, ticketBalancePercent: nonNegativeMoney(this.decimalInput(source.ticketBalancePercent), 'ticketBalancePercent'),
          familyTickets: this.integer(source.familyTickets) ?? 0, companyAccommodation: Boolean(source.companyAccommodation), companyTransportation: Boolean(source.companyTransportation),
          overtimeEligible: Boolean(source.overtimeEligible), companyFood: Boolean(source.companyFood), companyFuelCard: Boolean(source.companyFuelCard),
        };
        await tx.employeeBenefitProfile.upsert({ where: { employeeId: id }, create: { employeeId: id, ...benefits }, update: { ...benefits, version: { increment: 1 } } });
      }
      if (dto.salary) await this.updateSalaryHistory(id, dto.salary, tx);
      for (const raw of dto.credentials ?? []) {
        const type = this.text(raw.type);
        if (!type) continue;
        await tx.employeeCredential.upsert({
          where: { employeeId_type: { employeeId: id, type } },
          create: { employeeId: id, type, number: this.text(raw.number), profession: this.text(raw.profession), placeOfIssue: this.text(raw.placeOfIssue), issueDate: this.date(raw.issueDate), expiryDate: this.date(raw.expiryDate) },
          update: { number: this.text(raw.number), profession: this.text(raw.profession), placeOfIssue: this.text(raw.placeOfIssue), issueDate: this.date(raw.issueDate), expiryDate: this.date(raw.expiryDate), deletedAt: null },
        });
      }
      for (const raw of dto.education ?? []) {
        const qualification = this.text(raw.qualification);
        if (!qualification) continue;
        const existing = await tx.employeeEducation.findFirst({ where: { employeeId: id, qualification, deletedAt: null } });
        if (!existing) await tx.employeeEducation.create({ data: { employeeId: id, qualification, yearOfPassing: this.integer(raw.yearOfPassing) } });
      }
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'EmployeeDetails', entityId: id, summary: 'Employee profile details updated' });
      return tx.employee.findUniqueOrThrow({ where: { id }, include: employeeIncludeWithSalary });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
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

  private withoutSalary<T extends { salary: unknown; bankAccount?: unknown; benefits?: unknown; salaryRecords?: unknown }>(employee: T) {
    const safeEmployee = { ...employee } as Record<string, unknown>;
    delete safeEmployee.salary;
    delete safeEmployee.bankAccount;
    delete safeEmployee.benefits;
    delete safeEmployee.salaryRecords;
    return safeEmployee;
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

  private async updateSalaryHistory(employeeId: string, source: Record<string, unknown>, tx: Prisma.TransactionClient) {
    const values = {
      baseSalary: nonNegativeMoney(this.decimalInput(source.baseSalary), 'baseSalary'), allowances: nonNegativeMoney(this.decimalInput(source.allowances), 'allowances'),
      deductions: nonNegativeMoney(this.decimalInput(source.deductions), 'deductions'), bonuses: nonNegativeMoney(this.decimalInput(source.bonuses), 'bonuses'), taxRate: nonNegativeMoney(this.decimalInput(source.taxRate), 'taxRate'),
    };
    const current = await tx.salaryRecord.findFirst({ where: { employeeId, effectiveTo: null, deletedAt: null }, orderBy: { effectiveFrom: 'desc' } });
    if (current && current.baseSalary.equals(values.baseSalary) && current.allowances.equals(values.allowances) && current.deductions.equals(values.deductions) && current.bonuses.equals(values.bonuses) && current.taxRate.equals(values.taxRate)) return;
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    if (current?.effectiveFrom.getTime() === today.getTime()) await tx.salaryRecord.update({ where: { id: current.id }, data: { ...values, version: { increment: 1 } } });
    else {
      if (current) { const yesterday = new Date(today); yesterday.setUTCDate(yesterday.getUTCDate() - 1); await tx.salaryRecord.update({ where: { id: current.id }, data: { effectiveTo: yesterday, version: { increment: 1 } } }); }
      await tx.salaryRecord.create({ data: { employeeId, ...values, effectiveFrom: today } });
    }
    await tx.employee.update({ where: { id: employeeId }, data: { salary: money(values.baseSalary), version: { increment: 1 } } });
  }

  private text(value: unknown) { const result = value == null ? '' : String(value).trim(); return result || undefined; }
  private date(value: unknown) { const text = this.text(value); if (!text) return undefined; const parsed = new Date(`${text.slice(0, 10)}T00:00:00.000Z`); return Number.isNaN(parsed.getTime()) ? undefined : parsed; }
  private integer(value: unknown) { if (value === '' || value == null) return undefined; const parsed = Number(value); return Number.isInteger(parsed) ? parsed : undefined; }
  private decimalInput(value: unknown) { return value == null || value === '' ? '0' : String(value); }
}
