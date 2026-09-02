import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AuditAction, EmploymentStatus, Gender, Prisma, RoleProtection } from '@prisma/client';
import { randomUUID } from 'crypto';
import { hasActiveSystemAdministratorRole } from '../../common/authorization';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { hybridListRecords, searchText } from '../../common/utils/hybrid-search.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ImportEmployeeMasterDataDto, ImportEmployeeMasterDataRowDto } from './dto/import-employee-master-data.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { AuditService } from '../audit/audit.service';
import { money, nonNegativeMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { UpdateHrSensitiveDetailsDto, UpdatePayrollBankDto, UpdateSelfBasicProfileDto } from './dto/self-employee.dto';
import { AuthorizationService } from '../authorization/authorization.service';

const managerSummarySelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, email: true,
} satisfies Prisma.EmployeeSelect;

const employeeSummarySelect = {
  id: true, employeeCode: true, firstName: true, lastName: true, email: true,
  phone: true, hireDate: true, employmentStatus: true, departmentId: true, positionId: true,
  managerId: true, lineManagerId: true, profilePhoto: true, version: true, createdAt: true, updatedAt: true,
  department: { select: { id: true, name: true, code: true } },
  position: { select: { id: true, title: true, code: true, level: true } },
  manager: {
    select: managerSummarySelect,
  },
  lineManager: {
    select: managerSummarySelect,
  },
  user: {
    select: {
      roles: {
        where: { revokedAt: null, role: { isActive: true } },
        select: { role: { select: { code: true, displayName: true } } },
      },
    },
  },
} satisfies Prisma.EmployeeSelect;

const corporateEmailSuffix = '@med-tech.com';

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly authorization: AuthorizationService) {}

  async create(dto: CreateEmployeeDto, user: RequestUser) {
    this.assertUnrestrictedEmployeeWrite(user, 'employee.hr.create');
    const { accessRoleName, ...employeeDto } = dto;
    const roleName = accessRoleName?.trim();
    if (roleName) this.assertEmployeeAccessRoleCreation(user);
    await this.validateRelations(employeeDto);
    const email = employeeDto.email.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      const matchingUser = await tx.user.findFirst({
        where: { email: { equals: email, mode: 'insensitive' }, isActive: true, deletedAt: null },
        select: { id: true, employee: { select: { id: true } } },
      });
      if (matchingUser?.employee) throw new ConflictException('User is already linked to an employee');
      const autoUser = matchingUser ?? await this.createCorporateUser(tx, email, user);
      if (roleName && !autoUser) throw new BadRequestException('An access role requires a linked corporate login account');
      const accessRole = roleName ? await this.resolveEmployeeAccessRole(tx, roleName, user) : undefined;
      const employee = await tx.employee.create({
        data: { ...employeeDto, email, userId: autoUser?.id, salary: ZERO_MONEY },
        select: this.projection(user, false),
      });
      if (accessRole && autoUser) {
        await tx.userRole.upsert({
          where: { userId_roleId: { userId: autoUser.id, roleId: accessRole.id } },
          create: { userId: autoUser.id, roleId: accessRole.id, assignedById: user.id, reason: 'Employee access role selected during creation' },
          update: { revokedAt: null, expiresAt: null, assignedById: user.id, reason: 'Employee access role selected during creation' },
        });
        await this.audit.record(tx, user, { action: AuditAction.UPDATE, resourceType: 'UserRole', resourceId: autoUser.id, targetUserId: autoUser.id, summary: 'Employee access role assigned', after: { roleCode: accessRole.code, employeeId: employee.id } });
      }
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'Employee', entityId: employee.id, summary: 'Employee created' });
      return employee;
    }).catch((error: unknown) => this.rethrowEmailConflict(error));
  }

  async importMasterData(dto: ImportEmployeeMasterDataDto, user: RequestUser) {
    this.assertMasterDataImportAccess(user);
    if (!dto.rows.length) throw new BadRequestException('The import must contain at least one employee.');
    const codes = new Set<string>();
    for (const row of dto.rows) {
      const key = row.employeeCode.trim().toLocaleLowerCase();
      if (!key) throw new BadRequestException('Employee Code is required for every import row.');
      if (codes.has(key)) throw new BadRequestException(`Employee Code ${row.employeeCode} is duplicated in this import.`);
      codes.add(key);
    }

    return this.prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      const departments = new Map<string, string>();
      const positions = new Map<string, string>();

      for (const row of dto.rows) {
        const employeeCode = row.employeeCode.trim();
        const fullName = row.fullName.trim().replace(/\s+/g, ' ');
        const [firstName = '', ...lastName] = fullName.split(' ');
        if (!firstName) throw new BadRequestException(`Employee Code ${employeeCode} has an invalid name.`);
        const hireDate = new Date(`${row.joiningDate.slice(0, 10)}T00:00:00.000Z`);
        if (Number.isNaN(hireDate.getTime())) throw new BadRequestException(`Employee Code ${employeeCode} has an invalid joining date.`);

        const departmentName = row.department.trim();
        const departmentId = departments.get(departmentName) ?? await this.importDepartment(tx, departmentName);
        departments.set(departmentName, departmentId);
        const positionKey = `${departmentId}:${row.designation.trim().toLocaleLowerCase()}`;
        const positionId = positions.get(positionKey) ?? await this.importPosition(tx, departmentId, row.designation.trim());
        positions.set(positionKey, positionId);

        const salary = this.masterDataSalary(row, employeeCode);
        const dateOfBirth = row.dateOfBirth ? new Date(`${row.dateOfBirth.slice(0, 10)}T00:00:00.000Z`) : undefined;
        const existing = await tx.employee.findFirst({
          where: { employeeCode: { equals: employeeCode, mode: 'insensitive' } },
        });
        const employee = existing
          ? await tx.employee.update({
            where: { id: existing.id },
            data: { firstName, lastName: lastName.join(' '), hireDate, gender: this.importGender(row.gender), departmentId, positionId, salary: salary.baseSalary, ...(dateOfBirth ? { dateOfBirth } : {}), deletedAt: null, employmentStatus: existing.deletedAt ? EmploymentStatus.ACTIVE : undefined, version: { increment: 1 } },
          })
          : await tx.employee.create({
            data: {
              employeeCode, firstName, lastName: lastName.join(' '), email: `${employeeCode.toLocaleLowerCase()}@import.invalid`,
              hireDate, ...(dateOfBirth ? { dateOfBirth } : {}), gender: this.importGender(row.gender), employmentStatus: EmploymentStatus.ACTIVE, departmentId, positionId, salary: salary.baseSalary,
            },
          });
        if (existing) updated += 1; else created += 1;

        await tx.employeeProfile.upsert({
          where: { employeeId: employee.id },
          create: { employeeId: employee.id, company: row.company.trim(), workingCompanyName: row.company.trim(), wpsSponsor: row.wpsSponsor.trim() },
          update: { company: row.company.trim(), workingCompanyName: row.company.trim(), wpsSponsor: row.wpsSponsor.trim(), version: { increment: 1 } },
        });
        await tx.employeeBenefitProfile.upsert({
          where: { employeeId: employee.id },
          create: { employeeId: employee.id, companyConveyance: Boolean(row.companyConveyance), companyFuel: Boolean(row.companyFuel), companyOther: Boolean(row.companyOther) },
          update: { companyConveyance: Boolean(row.companyConveyance), companyFuel: Boolean(row.companyFuel), companyOther: Boolean(row.companyOther), version: { increment: 1 } },
        });

        const currentSalary = await tx.salaryRecord.findFirst({ where: { employeeId: employee.id, deletedAt: null, effectiveTo: null }, orderBy: { effectiveFrom: 'desc' } });
        if (currentSalary) {
          await tx.salaryRecord.update({ where: { id: currentSalary.id }, data: { ...salary, version: { increment: 1 } } });
        } else {
          await tx.salaryRecord.create({ data: { employeeId: employee.id, ...salary, effectiveFrom: hireDate } });
        }
      }

      const relationshipUpdates = await this.importRelationshipUpdates(tx, dto.rows);
      for (const update of relationshipUpdates) {
        await tx.employee.update({ where: { id: update.id }, data: { ...update.data, version: { increment: 1 } } });
      }

      await this.audit.record(tx, user, {
        action: AuditAction.CREATE, resourceType: 'EmployeeMasterDataImport', summary: 'Employee master data import completed',
        metadata: { created, updated, relationshipUpdates: relationshipUpdates.length, departmentCount: departments.size, positionCount: positions.size, recordCount: dto.rows.length },
      });
      return { created, updated, relationshipUpdates: relationshipUpdates.length, departments: departments.size, positions: positions.size };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async list(query: QueryEmployeesDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [await this.accessWhere(user)];

    if (query.departmentId) filters.push({ departmentId: query.departmentId });
    if (query.positionId) filters.push({ positionId: query.positionId });
    if (query.managerId) filters.push({ managerId: query.managerId });
    if (query.lineManagerId) filters.push({ lineManagerId: query.lineManagerId });
    if (query.employmentStatus) filters.push({ employmentStatus: query.employmentStatus });

    const result = await hybridListRecords(this.prisma, this.prisma.employee, query, {
      allowedSortFields: ['createdAt', 'employeeCode', 'firstName', 'lastName', 'hireDate', ...(user.permissions.includes('payroll.read_compensation') ? ['salary'] : [])],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      select: this.projection(user, false),
      searchDocument: (employee: any) => searchText(
        employee.employeeCode, employee.firstName, employee.lastName, employee.email, employee.phone,
        employee.department?.name, employee.department?.code, employee.position?.title, employee.position?.code,
        employee.employmentStatus,
        employee.user?.roles?.map((assignment: any) => [assignment.role.code, assignment.role.displayName]).flat(),
        employee.manager && [employee.manager.employeeCode, employee.manager.firstName, employee.manager.lastName],
        employee.lineManager && [employee.lineManager.employeeCode, employee.lineManager.firstName, employee.lineManager.lastName],
      ),
    });

    if (this.includesSensitiveFields(user)) {
      await this.audit.record(this.prisma, user, { action: AuditAction.ACCESS, entityType: 'Employee', summary: 'Sensitive employee records viewed' });
    }

    return result;
  }

  async upcomingBirthdays() {
    const today = this.companyDay(new Date());
    const employees = await this.prisma.employee.findMany({
      where: {
        deletedAt: null,
        employmentStatus: { in: [EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE] },
        dateOfBirth: { not: null },
      },
      select: {
        id: true, firstName: true, lastName: true, profilePhoto: true, dateOfBirth: true,
        department: { select: { name: true } },
      },
    });

    return employees.flatMap((employee) => {
      const dateOfBirth = employee.dateOfBirth!;
      let birthday = this.birthdayInYear(dateOfBirth, today.getUTCFullYear());
      if (birthday < today) birthday = this.birthdayInYear(dateOfBirth, today.getUTCFullYear() + 1);
      const daysUntil = Math.round((birthday.getTime() - today.getTime()) / 86_400_000);
      if (daysUntil > 30) return [];
      return [{
        id: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        department: employee.department?.name ?? null,
        profilePhoto: employee.profilePhoto,
        date: birthday.toISOString().slice(0, 10),
        daysUntil,
      }];
    }).sort((left, right) => left.daysUntil - right.daysUntil || `${left.firstName} ${left.lastName}`.localeCompare(`${right.firstName} ${right.lastName}`));
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
    const employeeDto = { ...dto };
    delete employeeDto.accessRoleName;
    await this.validateRelations(employeeDto, id, employee);
    const email = employeeDto.email?.trim().toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      if (email) await this.syncCorporateUser(tx, id, employee.userId, email, user);
      const updated = await tx.employee.update({
        where: { id },
        data: { ...employeeDto, ...(email ? { email } : {}), version: { increment: 1 } },
        select: this.projection(user, id === user.employeeId, id),
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'Employee', entityId: id, summary: 'Employee updated' });
      return updated;
    }).catch((error: unknown) => this.rethrowEmailConflict(error));
  }

  async remove(id: string, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, id, { all: 'employee.hr.terminate' });
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id, deletedAt: null } });
      if (!employee) throw new NotFoundException('Employee not found');
      const [directReport, managedDepartment] = await Promise.all([
        tx.employee.findFirst({ where: { OR: [{ managerId: id }, { lineManagerId: id }], deletedAt: null }, select: { id: true } }),
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
    await this.authorization.assertEmployeeScope(user, id, { all: 'employee.hr.read_sensitive' });
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
          familyTickets: this.integer(source.familyTickets) ?? 0, companyAccommodation: this.boolean(source.companyAccommodation), companyTransportation: this.boolean(source.companyTransportation),
          overtimeEligible: this.boolean(source.overtimeEligible), companyFood: this.boolean(source.companyFood), companyFuelCard: this.boolean(source.companyFuelCard),
          companyConveyance: this.boolean(source.companyConveyance), companyFuel: this.boolean(source.companyFuel), companyOther: this.boolean(source.companyOther),
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
      return tx.employee.findUniqueOrThrow({ where: { id }, select: this.projection(user, id === user.employeeId, id) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async ensureExists(id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  private async syncCorporateUser(tx: Prisma.TransactionClient, employeeId: string, userId: string | null, email: string, actor: RequestUser) {
    if (userId) {
      const account = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true, email: true, microsoftObjectId: true } });
      if (!account) throw new ConflictException('Employee is linked to an unavailable user');
      if (account.email === email) return;
      const conflict = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, id: { not: userId } }, select: { id: true } });
      if (conflict) throw new ConflictException('Email address is already in use');
      await tx.user.update({ where: { id: userId }, data: { email, microsoftObjectId: null, authorizationVersion: { increment: 1 } } });
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, actor, { action: AuditAction.UPDATE, resourceType: 'User', resourceId: userId, targetUserId: userId, summary: 'Linked login email updated', before: { email: account.email, microsoftObjectId: Boolean(account.microsoftObjectId) }, after: { email, microsoftIdentityCleared: Boolean(account.microsoftObjectId), sessionsRevoked: true } });
      return;
    }

    if (!email.endsWith(corporateEmailSuffix)) return;
    const existing = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, isActive: true, deletedAt: null }, select: { id: true, employee: { select: { id: true } } } });
    if (existing?.employee) throw new ConflictException('User is already linked to an employee');
    const account = existing ?? await this.createCorporateUser(tx, email, actor);
    if (account) await tx.employee.update({ where: { id: employeeId }, data: { userId: account.id } });
  }

  private async createCorporateUser(tx: Prisma.TransactionClient, email: string, actor: RequestUser) {
    if (!email.endsWith(corporateEmailSuffix) || !this.authorization.has(actor, 'user.manage')) return undefined;
    const role = await tx.role.findFirst({ where: { code: 'EMPLOYEE', isActive: true }, select: { id: true } });
    if (!role) throw new NotFoundException('Default Employee role is unavailable');
    const account = await tx.user.create({ data: { email, localLoginEnabled: false, microsoftLoginEnabled: true } });
    await tx.userRole.create({ data: { userId: account.id, roleId: role.id, assignedById: actor.id, reason: 'Corporate employee email' } });
    await this.audit.record(tx, actor, { action: AuditAction.CREATE, resourceType: 'User', resourceId: account.id, targetUserId: account.id, summary: 'Employee login created from corporate email', after: { email, localLoginEnabled: false, microsoftLoginEnabled: true, roleCode: 'EMPLOYEE' } });
    await tx.notification.create({ data: { userId: account.id, type: 'ACCOUNT_CREATED', title: 'Account created', message: 'Your HR account and Employee access were created.', resourceType: 'User', resourceId: account.id } });
    return account;
  }

  private assertEmployeeAccessRoleCreation(actor: RequestUser) {
    if (!hasActiveSystemAdministratorRole(actor) || !this.authorization.has(actor, 'user.manage')) {
      throw new ForbiddenException('Creating an access role while adding an employee requires an active system administrator with user management access');
    }
  }

  private async resolveEmployeeAccessRole(tx: Prisma.TransactionClient, displayName: string, actor: RequestUser) {
    const existing = await tx.role.findFirst({
      where: { displayName: { equals: displayName, mode: 'insensitive' } },
      select: { id: true, code: true, isActive: true, protection: true },
    });
    if (existing) {
      if (!existing.isActive) throw new BadRequestException('The selected access role is inactive');
      if (existing.protection !== RoleProtection.STANDARD) throw new BadRequestException('Protected access roles must be assigned from System access');
      return existing;
    }
    const base = `CUSTOM_${displayName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 93) || 'ROLE'}`;
    let code = base;
    for (let suffix = 2; await tx.role.findUnique({ where: { code }, select: { id: true } }); suffix += 1) code = `${base.slice(0, 99 - String(suffix).length)}_${suffix}`;
    const role = await tx.role.create({ data: { id: randomUUID(), code, displayName, createdById: actor.id } });
    await this.audit.record(tx, actor, { action: AuditAction.CREATE, resourceType: 'Role', resourceId: role.id, summary: 'Custom role created while adding employee', after: { code: role.code, displayName: role.displayName } });
    return role;
  }

  private rethrowEmailConflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002' && String(error.meta?.target).toLowerCase().includes('email')) {
      throw new ConflictException('Email address is already in use');
    }
    throw error;
  }

  private masterDataSalary(row: ImportEmployeeMasterDataRowDto, employeeCode: string) {
    const baseSalary = nonNegativeMoney(row.basic, `${employeeCode} basic salary`, '1000000000');
    const hra = nonNegativeMoney(row.hra, `${employeeCode} HRA`, '1000000000');
    const conveyance = nonNegativeMoney(row.conveyance, `${employeeCode} conveyance`, '1000000000');
    const mobile = nonNegativeMoney(row.mobile, `${employeeCode} mobile allowance`, '1000000000');
    const food = nonNegativeMoney(row.food, `${employeeCode} food allowance`, '1000000000');
    const fuel = nonNegativeMoney(row.fuel, `${employeeCode} fuel allowance`, '1000000000');
    const other = nonNegativeMoney(row.other, `${employeeCode} other allowance`, '1000000000');
    const grossSalary = nonNegativeMoney(row.grossSalary, `${employeeCode} gross salary`, '1000000000');
    const grossAdjustment = money(grossSalary.minus(sumMoney([baseSalary, hra, conveyance, mobile, food, fuel, other])), `${employeeCode} gross adjustment`);
    if (grossSalary.lt(baseSalary)) throw new BadRequestException(`Employee Code ${employeeCode} has a gross salary lower than basic salary.`);
    return { baseSalary, hra, conveyance, mobile, food, fuel, other, grossAdjustment, allowances: ZERO_MONEY, deductions: ZERO_MONEY, bonuses: ZERO_MONEY, taxRate: ZERO_MONEY };
  }

  private importGender(value: ImportEmployeeMasterDataRowDto['gender']): Gender {
    return ({ Male: Gender.MALE, Female: Gender.FEMALE, Other: Gender.OTHER } as const)[value];
  }

  private async importDepartment(tx: Prisma.TransactionClient, name: string) {
    const existing = await tx.department.findUnique({ where: { name } });
    if (existing) {
      if (existing.deletedAt) await tx.department.update({ where: { id: existing.id }, data: { deletedAt: null } });
      return existing.id;
    }
    return (await tx.department.create({ data: { name, code: await this.importDepartmentCode(tx, name) } })).id;
  }

  private async importPosition(tx: Prisma.TransactionClient, departmentId: string, title: string) {
    const existing = await tx.jobPosition.findFirst({ where: { departmentId, title, deletedAt: null }, select: { id: true } });
    if (existing) return existing.id;
    return (await tx.jobPosition.create({ data: { departmentId, title, code: await this.importPositionCode(tx, title) } })).id;
  }

  private async importDepartmentCode(tx: Prisma.TransactionClient, value: string) {
    const base = this.importCode('DEPT', value);
    let code = base;
    for (let suffix = 2; await tx.department.findUnique({ where: { code }, select: { id: true } }); suffix += 1) code = `${base.slice(0, 45)}-${suffix}`;
    return code;
  }

  private async importPositionCode(tx: Prisma.TransactionClient, value: string) {
    const base = this.importCode('POS', value);
    let code = base;
    for (let suffix = 2; await tx.jobPosition.findUnique({ where: { code }, select: { id: true } }); suffix += 1) code = `${base.slice(0, 45)}-${suffix}`;
    return code;
  }

  private importCode(prefix: string, value: string) {
    const slug = value.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 42) || 'IMPORT';
    return `${prefix}-${slug}`;
  }

  private assertMasterDataImportAccess(user: RequestUser) {
    const requiredScopes: Array<[string, AccessScopeType]> = [
      ['import.run', AccessScopeType.ALL_SYSTEM],
      ['department.manage', AccessScopeType.ALL_SYSTEM],
      ['position.manage', AccessScopeType.ALL_SYSTEM],
      ['employee.hr.create', AccessScopeType.ALL_EMPLOYEES],
      ['employee.hr.update', AccessScopeType.ALL_EMPLOYEES],
      ['employee.hr.read_sensitive', AccessScopeType.ALL_EMPLOYEES],
      ['payroll.configure', AccessScopeType.ALL_EMPLOYEES],
    ];
    for (const [permission, scopeType] of requiredScopes) {
      const rule = this.authorization.scopeRule(user, permission, scopeType);
      if (!rule.unrestricted || rule.excludeIds.length) {
        throw new ForbiddenException('This import requires unrestricted employee and master-data access.');
      }
    }
  }

  private assertUnrestrictedEmployeeWrite(user: RequestUser, permission: string) {
    const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
    if (!rule.unrestricted || rule.excludeIds.length) {
      throw new ForbiddenException('Creating employees requires unrestricted employee-write access.');
    }
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
      const directReports = await this.prisma.employee.findMany({ where: { lineManagerId: user.employeeId, deletedAt: null }, select: { id: true } });
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
        user: {
          select: {
            roles: {
              where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }], role: { isActive: true } },
              select: { role: { select: { code: true } } },
            },
          },
        },
      });
    }
    const compensationRule = this.authorization.scopeRule(user, 'payroll.read_compensation', AccessScopeType.ALL_EMPLOYEES);
    if ((employeeId ? this.authorization.permissionAllowedForScope(user, 'payroll.read_compensation', AccessScopeType.ALL_EMPLOYEES, employeeId) : compensationRule.unrestricted && compensationRule.excludeIds.length === 0) || (self && employeeId && this.authorization.permissionAllowedForScope(user, 'employee.self.read_compensation', AccessScopeType.SELF, employeeId))) {
      Object.assign(select, { salary: true, salaryRecords: { where: { deletedAt: null }, orderBy: { effectiveFrom: 'desc' } } });
    }
    const bankRule = this.authorization.scopeRule(user, 'payroll.read_bank', AccessScopeType.ALL_EMPLOYEES);
    if (employeeId ? this.authorization.permissionAllowedForScope(user, 'payroll.read_bank', AccessScopeType.ALL_EMPLOYEES, employeeId) : bankRule.unrestricted && bankRule.excludeIds.length === 0) {
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
    if (dto.managerId && dto.managerId === currentEmployeeId) throw new ForbiddenException('Employee cannot be their own manager');
    if (dto.lineManagerId && dto.lineManagerId === currentEmployeeId) throw new ForbiddenException('Employee cannot be their own line manager');

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

    await this.validateReportingRelation(dto.managerId, currentEmployeeId, 'managerId', 'Manager');
    await this.validateReportingRelation(dto.lineManagerId, currentEmployeeId, 'lineManagerId', 'Line manager');
  }

  private companyDay(value: Date) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value);
    return new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  }

  private birthdayInYear(dateOfBirth: Date, year: number) {
    const month = dateOfBirth.getUTCMonth();
    const birthday = dateOfBirth.getUTCDate();
    const day = month === 1 && birthday === 29 && !this.isLeapYear(year) ? 28 : birthday;
    return new Date(Date.UTC(year, month, day));
  }

  private isLeapYear(year: number) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }

  private async validateReportingRelation(relationId: string | undefined, currentEmployeeId: string | undefined, field: 'managerId' | 'lineManagerId', label: string) {
    let currentId: string | null = relationId ?? null;
    for (let depth = 0; currentId && depth < 32; depth += 1) {
      if (currentId === currentEmployeeId) throw new ForbiddenException(`${label} reporting lines cannot contain a cycle`);
      const employee: Pick<Prisma.EmployeeGetPayload<{ select: { managerId: true; lineManagerId: true } }>, 'managerId' | 'lineManagerId'> | null = await this.prisma.employee.findFirst({
        where: { id: currentId, deletedAt: null }, select: { managerId: true, lineManagerId: true },
      });
      if (!employee) throw new NotFoundException(`${label} not found`);
      currentId = employee[field];
    }
    if (currentId) throw new BadRequestException(`${label} reporting line is too deep to validate safely`);
  }

  private async importRelationshipUpdates(tx: Prisma.TransactionClient, rows: ImportEmployeeMasterDataRowDto[]) {
    const employees = await tx.employee.findMany({
      where: { deletedAt: null }, select: { id: true, employeeCode: true, firstName: true, lastName: true, managerId: true, lineManagerId: true },
    });
    const byCode = this.importRelationshipIndex(employees, (employee) => employee.employeeCode);
    const byName = this.importRelationshipIndex(employees, (employee) => `${employee.firstName} ${employee.lastName}`.trim());
    const updates: Array<{ id: string; data: { managerId?: string | null; lineManagerId?: string | null } }> = [];

    for (const row of rows) {
      const employee = this.resolveImportedEmployee(row.employeeCode, byCode, byName, 'Employee Code');
      const data: { managerId?: string | null; lineManagerId?: string | null } = {};
      if (row.manager !== undefined) data.managerId = this.resolveImportedEmployee(row.manager, byCode, byName, 'Manager').id;
      if (row.lineManager !== undefined) data.lineManagerId = this.resolveImportedEmployee(row.lineManager, byCode, byName, 'Line Manager').id;
      if (data.managerId === employee.id) throw new BadRequestException(`Employee Code ${row.employeeCode} cannot be their own manager.`);
      if (data.lineManagerId === employee.id) throw new BadRequestException(`Employee Code ${row.employeeCode} cannot be their own line manager.`);
      if (Object.keys(data).length) updates.push({ id: employee.id, data });
    }

    this.assertImportedRelationshipCycles(employees, updates, 'managerId', 'Manager');
    this.assertImportedRelationshipCycles(employees, updates, 'lineManagerId', 'Line Manager');
    return updates;
  }

  private importRelationshipIndex<T extends { id: string }>(employees: T[], value: (employee: T) => string) {
    const result = new Map<string, T[]>();
    for (const employee of employees) {
      const key = this.relationshipKey(value(employee));
      if (key) result.set(key, [...(result.get(key) ?? []), employee]);
    }
    return result;
  }

  private resolveImportedEmployee(value: string, byCode: Map<string, Array<{ id: string }>>, byName: Map<string, Array<{ id: string }>>, label: string) {
    const exact = this.relationshipKey(value);
    const matches = [...new Map([...(byCode.get(exact) ?? []), ...(byName.get(exact) ?? [])].map((employee) => [employee.id, employee])).values()];
    if (matches.length !== 1) throw new BadRequestException(`${label} ${value.trim() || '(blank)'} must match exactly one active employee code or full name.`);
    return matches[0];
  }

  private assertImportedRelationshipCycles(
    employees: Array<{ id: string; managerId: string | null; lineManagerId: string | null }>,
    updates: Array<{ id: string; data: { managerId?: string | null; lineManagerId?: string | null } }>,
    field: 'managerId' | 'lineManagerId', label: string,
  ) {
    const reporting = new Map(employees.map((employee) => [employee.id, employee[field]]));
    for (const update of updates) if (field in update.data) reporting.set(update.id, update.data[field] ?? null);
    for (const employee of employees) {
      const visited = new Set<string>([employee.id]);
      let currentId = reporting.get(employee.id) ?? null;
      for (let depth = 0; currentId && depth < 32; depth += 1) {
        if (visited.has(currentId)) throw new BadRequestException(`${label} reporting lines cannot contain a cycle.`);
        visited.add(currentId);
        currentId = reporting.get(currentId) ?? null;
      }
      if (currentId) throw new BadRequestException(`${label} reporting line is too deep to validate safely.`);
    }
  }

  private relationshipKey(value: string) { return value.trim().toLocaleLowerCase(); }

  private text(value: unknown) { const result = value == null ? '' : String(value).trim(); return result || undefined; }
  private date(value: unknown) { const text = this.text(value); if (!text) return undefined; const parsed = new Date(`${text.slice(0, 10)}T00:00:00.000Z`); return Number.isNaN(parsed.getTime()) ? undefined : parsed; }
  private integer(value: unknown) { if (value === '' || value == null) return undefined; const parsed = Number(value); return Number.isInteger(parsed) ? parsed : undefined; }
  private boolean(value: unknown) { return value === true || value === 'true' || value === 1 || value === '1'; }
  private decimalInput(value: unknown) { return value == null || value === '' ? '0' : String(value); }
}
