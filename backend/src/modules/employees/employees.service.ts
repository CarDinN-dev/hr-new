import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { AuditService } from '../audit/audit.service';
import { nonNegativeMoney, ZERO_MONEY } from '../../common/money';
import { UpdateHrSensitiveDetailsDto, UpdatePayrollBankDto, UpdateSelfBankDto, UpdateSelfBasicProfileDto } from './dto/self-employee.dto';

const managerSummarySelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, email: true,
} satisfies Prisma.EmployeeSelect;

const employeeSummarySelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, email: true,
  phone: true, hireDate: true, employmentStatus: true, departmentId: true, positionId: true,
  managerId: true, version: true, createdAt: true, updatedAt: true,
  department: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, title: true, code: true, level: true } },
  manager: {
    select: managerSummarySelect,
  },
} satisfies Prisma.EmployeeSelect;

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreateEmployeeDto, user: RequestUser) {
    await this.validateRelations(dto);
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.create({
        data: { ...dto, salary: ZERO_MONEY },
        select: this.projection(user, false),
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
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      select: this.projection(user, id === user.employeeId),
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
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id: user.employeeId! },
        data: { ...dto, version: { increment: 1 } },
        select: this.projection(user, true),
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Employee', entityId: user.employeeId!, summary: 'Self-service profile updated' });
      return updated;
    });
  }

  async updateSelfBank(dto: UpdateSelfBankDto, user: RequestUser) {
    if (!user.employeeId) throw new NotFoundException('No employee profile is linked to this user');
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
    const employee = await this.ensureExists(id);
    await this.validateRelations(dto, id, employee);
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.employee.update({
        where: { id },
        data: { ...dto, version: { increment: 1 } },
        select: this.projection(user, id === user.employeeId),
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
          data: { isActive: false, authorizationVersion: { increment: 1 } },
        });
        await tx.authSession.updateMany({ where: { userId: employee.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'Employee', entityId: id, summary: 'Employee archived' });
      return removed;
    });
  }

  async updateDetails(id: string, dto: UpdateHrSensitiveDetailsDto, user: RequestUser) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const sensitive = dto;
      if (
        sensitive.dateOfBirth !== undefined || sensitive.gender !== undefined || sensitive.address !== undefined
        || sensitive.emergencyContactName !== undefined || sensitive.emergencyContactPhone !== undefined
      ) {
        await tx.employee.update({
          where: { id },
          data: {
            dateOfBirth: sensitive.dateOfBirth,
            gender: sensitive.gender,
            address: sensitive.address,
            emergencyContactName: sensitive.emergencyContactName,
            emergencyContactPhone: sensitive.emergencyContactPhone,
            version: { increment: 1 },
          },
        });
      }
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
      return tx.employee.findUniqueOrThrow({ where: { id }, select: this.projection(user, id === user.employeeId) });
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
    if (user.permissions.includes('employee.hr.read') || user.permissions.includes('employee.audit.read')) return {};
    const scopes: Prisma.EmployeeWhereInput[] = [];
    if (user.employeeId && user.permissions.includes('employee.self.read')) scopes.push({ id: user.employeeId });
    if (user.employeeId && user.permissions.includes('employee.team.read')) scopes.push({ managerId: user.employeeId });
    if (user.permissions.includes('employee.department.read') && user.departmentScopeIds.length) {
      scopes.push({ departmentId: { in: user.departmentScopeIds } });
    }
    return scopes.length ? { OR: scopes } : { id: '__no_employee_scope__' };
  }

  private projection(user: RequestUser, self: boolean): Prisma.EmployeeSelect {
    const select: Prisma.EmployeeSelect = { ...employeeSummarySelect };
    if (self && user.permissions.includes('employee.self.read')) {
      Object.assign(select, {
        dateOfBirth: true, gender: true, address: true, emergencyContactName: true, emergencyContactPhone: true,
      });
    }
    if (user.permissions.includes('employee.hr.read_sensitive')) {
      Object.assign(select, {
        dateOfBirth: true, gender: true, address: true, emergencyContactName: true, emergencyContactPhone: true,
        profile: true, benefits: true,
        credentials: { where: { deletedAt: null } }, education: { where: { deletedAt: null } },
      });
    }
    if (user.permissions.includes('payroll.read_compensation') || (self && user.permissions.includes('employee.self.read_compensation'))) {
      Object.assign(select, { salary: true, salaryRecords: { where: { deletedAt: null }, orderBy: { effectiveFrom: 'desc' } } });
    }
    if (user.permissions.includes('payroll.read_bank') || (self && user.permissions.includes('employee.self.read_bank'))) {
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

  private text(value: unknown) { const result = value == null ? '' : String(value).trim(); return result || undefined; }
  private date(value: unknown) { const text = this.text(value); if (!text) return undefined; const parsed = new Date(`${text.slice(0, 10)}T00:00:00.000Z`); return Number.isNaN(parsed.getTime()) ? undefined : parsed; }
  private integer(value: unknown) { if (value === '' || value == null) return undefined; const parsed = Number(value); return Number.isInteger(parsed) ? parsed : undefined; }
  private decimalInput(value: unknown) { return value == null || value === '' ? '0' : String(value); }
}
