import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AccessScopeType, AttendanceStatus, AuditAction, CandidateStage, EosStatus, ExpenseStatus, Prisma,
  RecruitmentJobStatus, TripStatus,
} from '@prisma/client';
import { money, nonNegativeMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  CreateCandidateDto, CreateEosDto, CreateExpenseDto, CreateRecruitmentJobDto, CreateTripDto,
  EmployeeScopedQueryDto, QueryRecruitmentDto, TransitionCandidateDto, TransitionEosDto,
  TransitionExpenseDto, TransitionTripDto, UpdateCandidateDto, UpdateOrganizationSettingsDto, UpdateRecruitmentJobDto,
} from './dto/operations.dto';

const employeeSummary = { id: true, employeeCode: true, firstName: true, lastName: true, departmentId: true, managerId: true };

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly authorization: AuthorizationService) {}

  async createTrip(dto: CreateTripDto, user: RequestUser) {
    const employeeId = await this.resolveEmployee(dto.employeeId, user, 'trip.hr.manage');
    const days = this.inclusiveDays(dto.startDate, dto.endDate);
    return this.transaction(async (tx) => {
      const trip = await tx.businessTrip.create({
        data: {
          employeeId, destination: dto.destination, purpose: dto.purpose,
          startDate: this.day(dto.startDate), endDate: this.day(dto.endDate), days,
          perDiem: nonNegativeMoney(dto.perDiem ?? 0, 'perDiem'),
          travelCost: nonNegativeMoney(dto.travelCost ?? 0, 'travelCost'),
          advanceAmount: nonNegativeMoney(dto.advanceAmount ?? 0, 'advanceAmount'),
        },
        include: { employee: { select: employeeSummary } },
      });
      await this.record(tx, user, AuditAction.CREATE, 'BusinessTrip', trip.id, 'Business trip submitted');
      return trip;
    });
  }

  async listTrips(query: EmployeeScopedQueryDto, user: RequestUser) {
    const filters = await this.employeeFilters(query.employeeId, user, 'trip');
    if (query.status) filters.push({ status: query.status as TripStatus });
    return this.paginated(this.prisma.businessTrip, query, { AND: filters, deletedAt: null }, { employee: { select: employeeSummary } });
  }

  async transitionTrip(id: string, dto: TransitionTripDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const trip = await tx.businessTrip.findFirst({ where: { id, deletedAt: null } });
      if (!trip) throw new NotFoundException('Business trip not found');
      await this.assertManagerOrHr(trip.employeeId, user, tx, 'trip');
      const allowed: Record<TripStatus, TripStatus[]> = {
        PENDING: [TripStatus.APPROVED, TripStatus.REJECTED], APPROVED: [TripStatus.CLOSED], REJECTED: [], CLOSED: [],
      };
      if (!allowed[trip.status].includes(dto.status)) throw new BadRequestException('Invalid business-trip status transition');
      const updated = await tx.businessTrip.update({ where: { id }, data: { status: dto.status, version: { increment: 1 } } });
      await this.transitionAudit(tx, user, 'BusinessTrip', id, trip.status, dto.status);
      return updated;
    });
  }

  removeTrip(id: string, user: RequestUser) {
    return this.removeEmployeeOwnedRecord('businessTrip', 'BusinessTrip', id, user, TripStatus.PENDING, 'trip.hr.manage');
  }

  async createExpense(dto: CreateExpenseDto, user: RequestUser) {
    const employeeId = await this.resolveEmployee(dto.employeeId, user, 'expense.hr.approve');
    return this.transaction(async (tx) => {
      if (dto.tripId) {
        const trip = await tx.businessTrip.findFirst({ where: { id: dto.tripId, employeeId, deletedAt: null } });
        if (!trip) throw new NotFoundException('Business trip not found for this employee');
      }
      const expense = await tx.employeeExpense.create({
        data: { ...dto, employeeId, amount: nonNegativeMoney(dto.amount, 'amount'), expenseDate: this.day(dto.expenseDate) },
        include: { employee: { select: employeeSummary }, trip: true },
      });
      await this.record(tx, user, AuditAction.CREATE, 'EmployeeExpense', expense.id, 'Expense submitted');
      return expense;
    });
  }

  async listExpenses(query: EmployeeScopedQueryDto, user: RequestUser) {
    const filters = await this.employeeFilters(query.employeeId, user, 'expense');
    if (query.status) filters.push({ status: query.status as ExpenseStatus });
    return this.paginated(this.prisma.employeeExpense, query, { AND: filters, deletedAt: null }, { employee: { select: employeeSummary }, trip: true });
  }

  async transitionExpense(id: string, dto: TransitionExpenseDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const expense = await tx.employeeExpense.findFirst({ where: { id, deletedAt: null } });
      if (!expense) throw new NotFoundException('Expense not found');
      await this.assertManagerOrHr(expense.employeeId, user, tx, 'expense');
      const allowed: Record<ExpenseStatus, ExpenseStatus[]> = {
        SUBMITTED: [ExpenseStatus.APPROVED, ExpenseStatus.REJECTED], APPROVED: [ExpenseStatus.PAID], REJECTED: [], PAID: [],
      };
      if (!allowed[expense.status].includes(dto.status)) throw new BadRequestException('Invalid expense status transition');
      const updated = await tx.employeeExpense.update({ where: { id }, data: { status: dto.status, version: { increment: 1 } } });
      await this.transitionAudit(tx, user, 'EmployeeExpense', id, expense.status, dto.status);
      return updated;
    });
  }

  removeExpense(id: string, user: RequestUser) {
    return this.removeEmployeeOwnedRecord('employeeExpense', 'EmployeeExpense', id, user, ExpenseStatus.SUBMITTED, 'expense.hr.approve');
  }

  async createJob(dto: CreateRecruitmentJobDto, user: RequestUser) {
    this.assertSystemScope(user, 'recruitment.manage');
    if (dto.departmentId) await this.ensureDepartment(dto.departmentId);
    return this.transaction(async (tx) => {
      const job = await tx.recruitmentJob.create({ data: { ...dto, status: RecruitmentJobStatus.OPEN } });
      await this.record(tx, user, AuditAction.CREATE, 'RecruitmentJob', job.id, 'Recruitment job created');
      return job;
    });
  }

  listJobs(query: QueryRecruitmentDto, user: RequestUser) {
    const where = { deletedAt: null, ...this.systemRecordWhere(user, 'recruitment.read'), status: query.status, OR: query.search ? [{ title: { contains: query.search, mode: Prisma.QueryMode.insensitive } }] : undefined };
    return this.paginated(this.prisma.recruitmentJob, query, where, { department: true, candidates: true });
  }

  async updateJob(id: string, dto: UpdateRecruitmentJobDto, user: RequestUser) {
    this.assertSystemScope(user, 'recruitment.manage', id);
    if (dto.departmentId) await this.ensureDepartment(dto.departmentId);
    return this.transaction(async (tx) => {
      const existing = await tx.recruitmentJob.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Recruitment job not found');
      const updated = await tx.recruitmentJob.update({ where: { id }, data: { ...dto, version: { increment: 1 } }, include: { department: true } });
      await this.record(tx, user, AuditAction.UPDATE, 'RecruitmentJob', id, 'Recruitment job updated');
      return updated;
    });
  }

  removeJob(id: string, user: RequestUser) {
    this.assertSystemScope(user, 'recruitment.manage', id);
    return this.transaction(async (tx) => {
      const existing = await tx.recruitmentJob.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Recruitment job not found');
      const now = new Date();
      await tx.recruitmentCandidate.updateMany({ where: { jobId: id, deletedAt: null }, data: { deletedAt: now, version: { increment: 1 } } });
      const removed = await tx.recruitmentJob.update({ where: { id }, data: { deletedAt: now, version: { increment: 1 } } });
      await this.record(tx, user, AuditAction.DELETE, 'RecruitmentJob', id, 'Recruitment job and linked candidates archived');
      return removed;
    });
  }

  async createCandidate(dto: CreateCandidateDto, user: RequestUser) {
    this.assertSystemScope(user, 'recruitment.manage');
    const job = await this.prisma.recruitmentJob.findFirst({ where: { id: dto.jobId, status: RecruitmentJobStatus.OPEN, deletedAt: null } });
    if (!job) throw new NotFoundException('Open recruitment job not found');
    return this.transaction(async (tx) => {
      const candidate = await tx.recruitmentCandidate.create({
        data: { ...dto, email: dto.email.trim().toLowerCase(), rating: nonNegativeMoney(dto.rating ?? 0, 'rating') },
      });
      await this.record(tx, user, AuditAction.CREATE, 'RecruitmentCandidate', candidate.id, 'Candidate added');
      return candidate;
    });
  }

  listCandidates(query: QueryRecruitmentDto, user: RequestUser) {
    const where = {
      deletedAt: null, ...this.systemRecordWhere(user, 'recruitment.read'), jobId: query.jobId, stage: query.stage,
      OR: query.search ? [{ name: { contains: query.search, mode: Prisma.QueryMode.insensitive } }, { email: { contains: query.search, mode: Prisma.QueryMode.insensitive } }] : undefined,
    };
    return this.paginated(this.prisma.recruitmentCandidate, query, where, { job: { include: { department: true } }, employee: { select: employeeSummary } });
  }

  async updateCandidate(id: string, dto: UpdateCandidateDto, user: RequestUser) {
    this.assertSystemScope(user, 'recruitment.manage', id);
    return this.transaction(async (tx) => {
      const existing = await tx.recruitmentCandidate.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new NotFoundException('Candidate not found');
      if (dto.jobId) {
        const job = await tx.recruitmentJob.findFirst({ where: { id: dto.jobId, status: RecruitmentJobStatus.OPEN, deletedAt: null } });
        if (!job) throw new NotFoundException('Open recruitment job not found');
      }
      const updated = await tx.recruitmentCandidate.update({
        where: { id },
        data: {
          ...dto,
          email: dto.email?.trim().toLowerCase(),
          rating: dto.rating === undefined ? undefined : nonNegativeMoney(dto.rating, 'rating'),
          version: { increment: 1 },
        },
      });
      await this.record(tx, user, AuditAction.UPDATE, 'RecruitmentCandidate', id, 'Candidate details updated');
      return updated;
    });
  }

  async transitionCandidate(id: string, dto: TransitionCandidateDto, user: RequestUser) {
    this.assertSystemScope(user, 'recruitment.manage', id);
    return this.transaction(async (tx) => {
      const candidate = await tx.recruitmentCandidate.findFirst({ where: { id, deletedAt: null } });
      if (!candidate) throw new NotFoundException('Candidate not found');
      const order: CandidateStage[] = [CandidateStage.APPLIED, CandidateStage.SCREENING, CandidateStage.INTERVIEW, CandidateStage.OFFER, CandidateStage.HIRED];
      const rejection = dto.stage === CandidateStage.REJECTED;
      const current = order.indexOf(candidate.stage);
      const next = order.indexOf(dto.stage);
      const linkingHiredEmployee = candidate.stage === CandidateStage.HIRED && dto.stage === CandidateStage.HIRED && Boolean(dto.employeeId);
      if (!rejection && !linkingHiredEmployee && (current < 0 || next !== current + 1)) throw new BadRequestException('Candidate stages must move forward one step at a time');
      if (dto.employeeId) {
        if (dto.stage !== CandidateStage.HIRED) throw new BadRequestException('An employee can only be linked to a hired candidate');
        const employee = await tx.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null } });
        if (!employee) throw new NotFoundException('Employee not found');
      }
      const updated = await tx.recruitmentCandidate.update({
        where: { id }, data: { stage: dto.stage, employeeId: dto.stage === CandidateStage.HIRED ? dto.employeeId : candidate.employeeId, version: { increment: 1 } },
      });
      if (linkingHiredEmployee) {
        await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'RecruitmentCandidate', entityId: id, summary: 'Employee linked to hired candidate', changes: [{ field: 'employeeId', previousValue: candidate.employeeId, nextValue: dto.employeeId }] });
      } else {
        await this.transitionAudit(tx, user, 'RecruitmentCandidate', id, candidate.stage, dto.stage);
      }
      return updated;
    });
  }

  removeCandidate(id: string, user: RequestUser) { this.assertSystemScope(user, 'recruitment.manage', id); return this.softRemove('recruitmentCandidate', 'RecruitmentCandidate', id, user); }

  async createEos(dto: CreateEosDto, user: RequestUser) {
    await this.authorization.assertEmployeeScope(user, dto.employeeId, { all: 'eos.manage' });
    return this.transaction(async (tx) => {
      const employee = await tx.employee.findFirst({ where: { id: dto.employeeId, deletedAt: null } });
      if (!employee) throw new NotFoundException('Employee not found');
      const asOf = this.day(dto.asOf);
      if (asOf < this.day(employee.hireDate)) throw new BadRequestException('Settlement date cannot precede hire date');
      const duplicate = await tx.eosRecord.findFirst({ where: { employeeId: dto.employeeId, asOf, status: { in: [EosStatus.DRAFT, EosStatus.APPROVED] }, deletedAt: null } });
      if (duplicate) throw new ConflictException('An open end-of-service record already exists for this date');
      const salary = await tx.salaryRecord.findFirst({
        where: { employeeId: dto.employeeId, effectiveFrom: { lte: asOf }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }], deletedAt: null },
        orderBy: { effectiveFrom: 'desc' },
      });
      const basic = nonNegativeMoney(salary?.baseSalary ?? employee.salary, 'baseSalary');
      const monthlyTotal = sumMoney([basic, salary?.allowances ?? 0, salary?.bonuses ?? 0]);
      const serviceDays = Math.max(0, Math.floor((asOf.getTime() - this.day(employee.hireDate).getTime()) / 86_400_000));
      const serviceYears = new Prisma.Decimal(serviceDays).div('365.2425').toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const gratuity = serviceYears.gte(1) ? money(basic.div(30).times(21).times(serviceYears), 'gratuity') : ZERO_MONEY;
      const year = asOf.getUTCFullYear();
      const balances = await tx.leaveBalance.findMany({ where: { employeeId: dto.employeeId, year, deletedAt: null }, select: { totalDays: true, usedDays: true, pendingDays: true } });
      const remainingLeave = sumMoney(balances.map((b) => Prisma.Decimal.max(ZERO_MONEY, b.totalDays.minus(b.usedDays).minus(b.pendingDays))));
      const leaveEncashment = money(basic.div(30).times(remainingLeave), 'leaveEncashment');
      const attendance = await tx.attendance.findMany({ where: { employeeId: dto.employeeId, attendanceDate: { lte: asOf }, status: { in: [AttendanceStatus.ABSENT, AttendanceStatus.HALF_DAY] }, deletedAt: null }, select: { status: true } });
      const lopDays = sumMoney(attendance.map((row) => row.status === AttendanceStatus.ABSENT ? 1 : '0.5'));
      const lopDeduction = money(monthlyTotal.div(30).times(lopDays), 'lopDeduction');
      const expenses = await tx.employeeExpense.findMany({ where: { employeeId: dto.employeeId, status: ExpenseStatus.APPROVED, deletedAt: null }, select: { amount: true } });
      const trips = await tx.businessTrip.findMany({ where: { employeeId: dto.employeeId, status: TripStatus.APPROVED, deletedAt: null }, select: { advanceAmount: true } });
      const expenseReimbursement = sumMoney(expenses.map((row) => row.amount));
      const tripAdvanceDeduction = sumMoney(trips.map((row) => row.advanceAmount));
      const netSettlement = money(Prisma.Decimal.max(ZERO_MONEY, gratuity.plus(leaveEncashment).plus(expenseReimbursement).minus(lopDeduction).minus(tripAdvanceDeduction)), 'netSettlement');
      const settings = await tx.organizationSettings.findUnique({ where: { id: 'default' } });
      const eos = await tx.eosRecord.create({ data: {
        employeeId: dto.employeeId, asOf, reason: dto.reason, serviceYears, gratuity, leaveEncashment,
        lopDeduction, expenseReimbursement, tripAdvanceDeduction, netSettlement,
        policyVersion: settings?.financialPolicyVersion ?? 1,
      } });
      await this.record(tx, user, AuditAction.CREATE, 'EosRecord', eos.id, 'End-of-service calculation created');
      return eos;
    });
  }

  listEos(query: EmployeeScopedQueryDto, user: RequestUser) {
    const where = { deletedAt: null, AND: [this.employeeRecordWhere(user, 'eos.read'), ...(query.employeeId ? [{ employeeId: query.employeeId }] : [])], status: query.status as EosStatus | undefined };
    return this.paginated(this.prisma.eosRecord, query, where, { employee: { select: employeeSummary } });
  }

  async transitionEos(id: string, dto: TransitionEosDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const eos = await tx.eosRecord.findFirst({ where: { id, deletedAt: null } });
      if (!eos) throw new NotFoundException('End-of-service record not found');
      await this.authorization.assertEmployeeScope(user, eos.employeeId, { all: 'eos.manage' });
      const allowed = eos.status === EosStatus.DRAFT ? EosStatus.APPROVED : eos.status === EosStatus.APPROVED ? EosStatus.PAID : null;
      if (dto.status !== allowed) throw new BadRequestException('Invalid end-of-service status transition');
      const updated = await tx.eosRecord.update({ where: { id }, data: { status: dto.status, version: { increment: 1 } } });
      await this.transitionAudit(tx, user, 'EosRecord', id, eos.status, dto.status);
      return updated;
    });
  }

  removeEos(id: string, user: RequestUser) {
    return this.transaction(async (tx) => {
      const record = await tx.eosRecord.findFirst({ where: { id, deletedAt: null } });
      if (!record) throw new NotFoundException('End-of-service record not found');
      await this.authorization.assertEmployeeScope(user, record.employeeId, { all: 'eos.manage' });
      const removed = await tx.eosRecord.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.record(tx, user, AuditAction.DELETE, 'EosRecord', id, 'End-of-service record archived');
      return removed;
    });
  }

  async getSettings(user: RequestUser) {
    this.assertSystemScope(user, 'organization.read', 'default');
    return this.prisma.organizationSettings.findUnique({ where: { id: 'default' } });
  }

  async updateSettings(dto: UpdateOrganizationSettingsDto, user: RequestUser) {
    this.assertSystemScope(user, 'system.configure', 'default');
    return this.transaction(async (tx) => {
      const previous = await tx.organizationSettings.findUnique({ where: { id: 'default' } });
      const data = {
        ...dto,
        workdayHours: dto.workdayHours === undefined ? undefined : nonNegativeMoney(dto.workdayHours, 'workdayHours'),
        halfDayHours: dto.halfDayHours === undefined ? undefined : nonNegativeMoney(dto.halfDayHours, 'halfDayHours'),
        loanCapValue: dto.loanCapValue === undefined ? undefined : nonNegativeMoney(dto.loanCapValue, 'loanCapValue'),
      };
      if (!previous && (!dto.name || !dto.legalName)) throw new BadRequestException('name and legalName are required when creating settings');
      const workdayHours = data.workdayHours ?? previous?.workdayHours ?? new Prisma.Decimal(8);
      const halfDayHours = data.halfDayHours ?? previous?.halfDayHours ?? new Prisma.Decimal(4);
      if (workdayHours.lte(0) || halfDayHours.lte(0) || halfDayHours.gt(workdayHours)) {
        throw new BadRequestException('Half-day hours must be positive and cannot exceed full-day hours');
      }
      const capType = dto.loanCapType ?? previous?.loanCapType ?? 'AMOUNT';
      const capValue = data.loanCapValue ?? previous?.loanCapValue ?? ZERO_MONEY;
      if (capType === 'PERCENT' && capValue.gt(100)) throw new BadRequestException('Percentage loan cap cannot exceed 100');
      const settings = await tx.organizationSettings.upsert({
        where: { id: 'default' },
        create: { id: 'default', name: dto.name!, legalName: dto.legalName!, ...data },
        update: { ...data, version: { increment: 1 } },
      });
      await this.record(tx, user, previous ? AuditAction.UPDATE : AuditAction.CREATE, 'OrganizationSettings', 'default', 'Organization settings saved');
      return settings;
    });
  }

  private async resolveEmployee(requested: string | undefined, user: RequestUser, allPermission: string) {
    const id = requested ?? user.employeeId;
    if (!id) throw new NotFoundException('No employee profile is linked to this user');
    const resource = allPermission.split('.')[0];
    if (id === user.employeeId) {
      if (!this.authorization.permissionAllowedForScope(user, `${resource}.self.create`, AccessScopeType.SELF, id)) throw new NotFoundException('Employee not found');
    } else if (!this.authorization.permissionAllowedForScope(user, allPermission, AccessScopeType.ALL_EMPLOYEES, id)) throw new NotFoundException('Employee not found');
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
    return id;
  }

  private async employeeFilters(requested: string | undefined, user: RequestUser, resource: 'trip' | 'expense'): Promise<Record<string, unknown>[]> {
    const scopes: Prisma.BusinessTripWhereInput[] = [];
    let unrestricted = false;
    for (const permission of [`${resource}.hr.read`, `${resource}.read_all`] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) { unrestricted = true; break; }
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (!unrestricted && user.employeeId && this.authorization.permissionAllowedForScope(user, `${resource}.self.read`, AccessScopeType.SELF, user.employeeId)) scopes.push({ employeeId: user.employeeId });
    if (!unrestricted && user.employeeId && this.authorization.has(user, `${resource}.team.read`)) {
      const ids = (await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } })).map(({ id }) => id)
        .filter((id) => this.authorization.permissionAllowedForScope(user, `${resource}.team.read`, AccessScopeType.DIRECT_REPORTS, id));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    if (!unrestricted && user.employeeId && this.authorization.has(user, `${resource}.management.read`)) {
      const ids = (await this.authorization.managementTreeEmployeeIds(user.employeeId))
        .filter((id) => this.authorization.permissionAllowedForScope(user, `${resource}.management.read`, AccessScopeType.MANAGEMENT_TREE, id));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    return [
      ...(unrestricted ? [] : [{ OR: scopes.length ? scopes : [{ employeeId: '__no_employee_scope__' }] }]),
      ...(requested ? [{ employeeId: requested }] : []),
    ];
  }

  private async assertManagerOrHr(employeeId: string, user: RequestUser, tx: Prisma.TransactionClient, resource: 'trip' | 'expense') {
    const hrPermission = resource === 'trip' ? 'trip.hr.manage' : 'expense.hr.approve';
    if (this.authorization.permissionAllowedForScope(user, hrPermission, AccessScopeType.ALL_EMPLOYEES, employeeId)) return;
    const report = await tx.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { managerId: true } });
    if (!report) throw new NotFoundException('Record not found');
    if (user.employeeId && report.managerId === user.employeeId && this.authorization.permissionAllowedForScope(user, `${resource}.team.approve_manager`, AccessScopeType.DIRECT_REPORTS, employeeId)) return;
    if (user.employeeId && await this.authorization.isInManagementTree(user.employeeId, employeeId) && this.authorization.permissionAllowedForScope(user, `${resource}.management.approve_manager`, AccessScopeType.MANAGEMENT_TREE, employeeId)) return;
    throw new NotFoundException('Record not found');
  }

  private employeeRecordWhere(user: RequestUser, permission: string) {
    const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
    return rule.unrestricted
      ? (rule.excludeIds.length ? { employeeId: { notIn: rule.excludeIds } } : {})
      : { employeeId: { in: rule.includeIds, notIn: rule.excludeIds } };
  }

  private systemRecordWhere(user: RequestUser, permission: string) {
    const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_SYSTEM);
    return rule.unrestricted
      ? (rule.excludeIds.length ? { id: { notIn: rule.excludeIds } } : {})
      : { id: { in: rule.includeIds, notIn: rule.excludeIds } };
  }

  private assertSystemScope(user: RequestUser, permission: string, resourceId?: string) {
    if (this.authorization.permissionAllowedForScope(user, permission, AccessScopeType.ALL_SYSTEM, resourceId)) return;
    if (resourceId) throw new NotFoundException('Record not found');
    throw new ForbiddenException('Insufficient permission');
  }

  private async ensureDepartment(id: string) {
    if (!await this.prisma.department.findFirst({ where: { id, deletedAt: null } })) throw new NotFoundException('Department not found');
  }

  private inclusiveDays(start: Date, end: Date) {
    const startDay = this.day(start); const endDay = this.day(end);
    if (endDay < startDay) throw new BadRequestException('endDate must be on or after startDate');
    return new Prisma.Decimal(Math.floor((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1);
  }

  private day(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())); }

  private paginated(delegate: any, query: EmployeeScopedQueryDto | QueryRecruitmentDto, where: object, include: object) {
    const page = query.page ?? 1; const limit = query.limit ?? 20;
    return Promise.all([
      delegate.findMany({ where, include, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' } }),
      delegate.count({ where }),
    ]).then(([data, total]) => ({ data, meta: paginationMeta(total, page, limit) }));
  }

  private record(tx: Prisma.TransactionClient, user: RequestUser, action: AuditAction, entityType: string, entityId: string, summary: string) {
    return this.audit.record(tx, user, { action, entityType, entityId, summary });
  }

  private softRemove(delegateName: 'businessTrip' | 'employeeExpense' | 'recruitmentCandidate' | 'eosRecord', entityType: string, id: string, user: RequestUser) {
    return this.transaction(async (tx) => {
      const delegate = tx[delegateName] as unknown as { findFirst(args: object): Promise<{ id: string } | null>; update(args: object): Promise<unknown> };
      const record = await delegate.findFirst({ where: { id, deletedAt: null } });
      if (!record) throw new NotFoundException(`${entityType} not found`);
      const removed = await delegate.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.record(tx, user, AuditAction.DELETE, entityType, id, `${entityType} archived`);
      return removed;
    });
  }

  private removeEmployeeOwnedRecord(
    delegateName: 'businessTrip' | 'employeeExpense',
    entityType: string,
    id: string,
    user: RequestUser,
    editableStatus: TripStatus | ExpenseStatus,
    allPermission: string,
  ) {
    return this.transaction(async (tx) => {
      const delegate = tx[delegateName] as unknown as {
        findFirst(args: object): Promise<{ id: string; employeeId: string; status: TripStatus | ExpenseStatus } | null>;
        update(args: object): Promise<unknown>;
      };
      const record = await delegate.findFirst({ where: { id, deletedAt: null } });
      if (!record) throw new NotFoundException(`${entityType} not found`);
      if (!this.authorization.permissionAllowedForScope(user, allPermission, AccessScopeType.ALL_EMPLOYEES, record.employeeId)) {
        const selfPermission = `${allPermission.split('.')[0]}.self.create`;
        if (!user.employeeId || record.employeeId !== user.employeeId || !this.authorization.permissionAllowedForScope(user, selfPermission, AccessScopeType.SELF, record.employeeId)) throw new NotFoundException(`${entityType} not found`);
        if (record.status !== editableStatus) throw new BadRequestException(`Only an unprocessed ${entityType.toLowerCase()} can be deleted`);
      }
      const removed = await delegate.update({ where: { id }, data: { deletedAt: new Date(), version: { increment: 1 } } });
      await this.record(tx, user, AuditAction.DELETE, entityType, id, `${entityType} archived`);
      return removed;
    });
  }

  private transitionAudit(tx: Prisma.TransactionClient, user: RequestUser, entityType: string, entityId: string, previous: string, next: string) {
    return this.audit.record(tx, user, { action: AuditAction.TRANSITION, entityType, entityId, summary: `${entityType} status changed`, changes: [{ field: 'status', previousValue: previous, nextValue: next }] });
  }

  private async transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error; }
    }
    throw new ConflictException('Record changed in another request. Try again.');
  }
}
