import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AttendanceStatus, AuditAction, CandidateStage, EosStatus, ExpenseStatus, Prisma,
  RecruitmentJobStatus, Role, TripStatus,
} from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { money, nonNegativeMoney, sumMoney, ZERO_MONEY } from '../../common/money';
import { RequestUser } from '../../common/types/request-user.type';
import { paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  CreateCandidateDto, CreateEosDto, CreateExpenseDto, CreateRecruitmentJobDto, CreateTripDto,
  EmployeeScopedQueryDto, QueryRecruitmentDto, TransitionCandidateDto, TransitionEosDto,
  TransitionExpenseDto, TransitionTripDto, UpdateOrganizationSettingsDto,
} from './dto/operations.dto';

const employeeSummary = { id: true, employeeCode: true, firstName: true, lastName: true, departmentId: true, managerId: true };

@Injectable()
export class OperationsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async createTrip(dto: CreateTripDto, user: RequestUser) {
    const employeeId = await this.resolveEmployee(dto.employeeId, user);
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
    const filters = await this.employeeFilters(query.employeeId, user);
    if (query.status) filters.push({ status: query.status as TripStatus });
    return this.paginated(this.prisma.businessTrip, query, { AND: filters, deletedAt: null }, { employee: { select: employeeSummary } });
  }

  async transitionTrip(id: string, dto: TransitionTripDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const trip = await tx.businessTrip.findFirst({ where: { id, deletedAt: null }, include: { employee: true } });
      if (!trip) throw new NotFoundException('Business trip not found');
      await this.assertManagerOrHr(trip.employeeId, user, tx);
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
    return this.removeEmployeeOwnedRecord('businessTrip', 'BusinessTrip', id, user, TripStatus.PENDING);
  }

  async createExpense(dto: CreateExpenseDto, user: RequestUser) {
    const employeeId = await this.resolveEmployee(dto.employeeId, user);
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
    const filters = await this.employeeFilters(query.employeeId, user);
    if (query.status) filters.push({ status: query.status as ExpenseStatus });
    return this.paginated(this.prisma.employeeExpense, query, { AND: filters, deletedAt: null }, { employee: { select: employeeSummary }, trip: true });
  }

  async transitionExpense(id: string, dto: TransitionExpenseDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const expense = await tx.employeeExpense.findFirst({ where: { id, deletedAt: null } });
      if (!expense) throw new NotFoundException('Expense not found');
      await this.assertManagerOrHr(expense.employeeId, user, tx);
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
    return this.removeEmployeeOwnedRecord('employeeExpense', 'EmployeeExpense', id, user, ExpenseStatus.SUBMITTED);
  }

  async createJob(dto: CreateRecruitmentJobDto, user: RequestUser) {
    if (dto.departmentId) await this.ensureDepartment(dto.departmentId);
    return this.transaction(async (tx) => {
      const job = await tx.recruitmentJob.create({ data: { ...dto, status: RecruitmentJobStatus.OPEN } });
      await this.record(tx, user, AuditAction.CREATE, 'RecruitmentJob', job.id, 'Recruitment job created');
      return job;
    });
  }

  listJobs(query: QueryRecruitmentDto) {
    const where = { deletedAt: null, status: query.status, OR: query.search ? [{ title: { contains: query.search, mode: Prisma.QueryMode.insensitive } }] : undefined };
    return this.paginated(this.prisma.recruitmentJob, query, where, { department: true, candidates: true });
  }

  async createCandidate(dto: CreateCandidateDto, user: RequestUser) {
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

  listCandidates(query: QueryRecruitmentDto) {
    const where = {
      deletedAt: null, jobId: query.jobId, stage: query.stage,
      OR: query.search ? [{ name: { contains: query.search, mode: Prisma.QueryMode.insensitive } }, { email: { contains: query.search, mode: Prisma.QueryMode.insensitive } }] : undefined,
    };
    return this.paginated(this.prisma.recruitmentCandidate, query, where, { job: { include: { department: true } }, employee: { select: employeeSummary } });
  }

  async transitionCandidate(id: string, dto: TransitionCandidateDto, user: RequestUser) {
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

  removeCandidate(id: string, user: RequestUser) { return this.softRemove('recruitmentCandidate', 'RecruitmentCandidate', id, user); }

  async createEos(dto: CreateEosDto, user: RequestUser) {
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

  listEos(query: EmployeeScopedQueryDto) {
    const where = { deletedAt: null, employeeId: query.employeeId, status: query.status as EosStatus | undefined };
    return this.paginated(this.prisma.eosRecord, query, where, { employee: { select: employeeSummary } });
  }

  async transitionEos(id: string, dto: TransitionEosDto, user: RequestUser) {
    return this.transaction(async (tx) => {
      const eos = await tx.eosRecord.findFirst({ where: { id, deletedAt: null } });
      if (!eos) throw new NotFoundException('End-of-service record not found');
      const allowed = eos.status === EosStatus.DRAFT ? EosStatus.APPROVED : eos.status === EosStatus.APPROVED ? EosStatus.PAID : null;
      if (dto.status !== allowed) throw new BadRequestException('Invalid end-of-service status transition');
      const updated = await tx.eosRecord.update({ where: { id }, data: { status: dto.status, version: { increment: 1 } } });
      await this.transitionAudit(tx, user, 'EosRecord', id, eos.status, dto.status);
      return updated;
    });
  }

  removeEos(id: string, user: RequestUser) { return this.softRemove('eosRecord', 'EosRecord', id, user); }

  async getSettings() {
    return this.prisma.organizationSettings.findUnique({ where: { id: 'default' } });
  }

  async updateSettings(dto: UpdateOrganizationSettingsDto, user: RequestUser) {
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

  private async resolveEmployee(requested: string | undefined, user: RequestUser) {
    const id = requested ?? user.employeeId;
    if (!id) throw new NotFoundException('No employee profile is linked to this user');
    if (requested && requested !== user.employeeId && !hasHrAccess(user.role)) throw new ForbiddenException('Only HR can submit for another employee');
    const employee = await this.prisma.employee.findFirst({ where: { id, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
    return id;
  }

  private async employeeFilters(requested: string | undefined, user: RequestUser): Promise<Record<string, unknown>[]> {
    if (hasHrAccess(user.role)) return requested ? [{ employeeId: requested }] : [];
    if (!user.employeeId) return [{ employeeId: '__no_employee_profile__' }];
    if (requested && requested !== user.employeeId && user.role !== Role.MANAGER) throw new ForbiddenException('Cannot access another employee');
    if (user.role === Role.MANAGER) return [{ OR: [{ employeeId: user.employeeId }, { employee: { managerId: user.employeeId } }] }, ...(requested ? [{ employeeId: requested }] : [])];
    return [{ employeeId: user.employeeId }];
  }

  private async assertManagerOrHr(employeeId: string, user: RequestUser, tx: Prisma.TransactionClient) {
    if (hasHrAccess(user.role)) return;
    if (user.role !== Role.MANAGER || !user.employeeId) throw new ForbiddenException('Manager or HR access required');
    const report = await tx.employee.findFirst({ where: { id: employeeId, managerId: user.employeeId, deletedAt: null } });
    if (!report) throw new ForbiddenException('Managers can only decide requests for direct reports');
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
  ) {
    return this.transaction(async (tx) => {
      const delegate = tx[delegateName] as unknown as {
        findFirst(args: object): Promise<{ id: string; employeeId: string; status: TripStatus | ExpenseStatus } | null>;
        update(args: object): Promise<unknown>;
      };
      const record = await delegate.findFirst({ where: { id, deletedAt: null } });
      if (!record) throw new NotFoundException(`${entityType} not found`);
      if (!hasHrAccess(user.role)) {
        if (!user.employeeId || record.employeeId !== user.employeeId) throw new ForbiddenException(`Cannot delete this ${entityType.toLowerCase()}`);
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
