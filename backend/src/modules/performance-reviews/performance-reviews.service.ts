import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessScopeType, AuditAction, Prisma, ReviewStatus } from '@prisma/client';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { CreatePerformanceReviewDto } from './dto/create-performance-review.dto';
import { QueryPerformanceReviewsDto } from './dto/query-performance-reviews.dto';
import { UpdatePerformanceReviewDto } from './dto/update-performance-review.dto';

const reviewInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  reviewer: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class PerformanceReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly authorization: AuthorizationService,
  ) {}

  async create(dto: CreatePerformanceReviewDto, user: RequestUser) {
    await this.ensureEmployee(dto.employeeId);
    const hrManage = this.authorization.permissionAllowedForScope(user, 'performance.hr.manage', AccessScopeType.ALL_EMPLOYEES, dto.employeeId);
    const reviewerId = hrManage ? dto.reviewerId ?? user.employeeId : user.employeeId;
    if (!reviewerId) throw new NotFoundException('Reviewer employee profile is required');
    if (!hrManage && dto.reviewerId && dto.reviewerId !== reviewerId) {
      throw new ForbiddenException('Managers cannot submit reviews as another employee');
    }
    await this.ensureEmployee(reviewerId);
    await this.assertCanReview(dto.employeeId, user);
    this.assertReviewPeriod(dto.reviewPeriodStart, dto.reviewPeriodEnd);
    this.assertManagerStatus(dto.status, user, dto.employeeId);
    return this.transaction(async (tx) => {
      const review = await tx.performanceReview.create({
        data: { ...dto, reviewerId },
        include: reviewInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'PerformanceReview', entityId: review.id, summary: 'Performance review created', subjectEmployeeId: dto.employeeId });
      return review;
    });
  }

  async list(query: QueryPerformanceReviewsDto, user: RequestUser) {
    const filters: Prisma.PerformanceReviewWhereInput[] = [await this.accessWhere(user)];
    if (query.employeeId) filters.push({ employeeId: query.employeeId });
    if (query.reviewerId) filters.push({ reviewerId: query.reviewerId });
    if (query.status) filters.push({ status: query.status });

    const { page, limit, ...args } = listArgs(query, {
      allowedSortFields: ['createdAt', 'reviewPeriodStart', 'reviewPeriodEnd', 'rating', 'status'],
      defaultSortBy: 'createdAt',
      where: { AND: filters },
      include: reviewInclude,
    });

    const [data, total] = await Promise.all([
      this.prisma.performanceReview.findMany(args),
      this.prisma.performanceReview.count({ where: args.where }),
    ]);
    return { data, meta: paginationMeta(total, page, limit) };
  }

  async findById(id: string, user: RequestUser) {
    const review = await this.prisma.performanceReview.findFirst({
      where: { AND: [{ id }, { deletedAt: null }, await this.accessWhere(user)] },
      include: reviewInclude,
    });
    if (!review) throw new NotFoundException('Performance review not found');
    return review;
  }

  async update(id: string, dto: UpdatePerformanceReviewDto, user: RequestUser) {
    const review = await this.ensureExists(id);
    await this.assertCanReview(review.employeeId, user);
    const hrManage = this.authorization.permissionAllowedForScope(user, 'performance.hr.manage', AccessScopeType.ALL_EMPLOYEES, review.employeeId);
    if (!hrManage && review.reviewerId !== user.employeeId) {
      throw new ForbiddenException('Managers can only update reviews they created');
    }
    if (
      !hrManage
      && review.status !== ReviewStatus.DRAFT
      && review.status !== ReviewStatus.SUBMITTED
    ) {
      throw new ForbiddenException('Acknowledged or closed reviews can only be changed by HR');
    }
    if (dto.employeeId) {
      await this.ensureEmployee(dto.employeeId);
      await this.assertCanReview(dto.employeeId, user);
    }

    let reviewerId = dto.reviewerId;
    if (!hrManage) {
      if (!user.employeeId) throw new NotFoundException('Reviewer employee profile is required');
      if (reviewerId && reviewerId !== user.employeeId) {
        throw new ForbiddenException('Managers cannot submit reviews as another employee');
      }
      reviewerId = user.employeeId;
    } else if (reviewerId) {
      await this.ensureEmployee(reviewerId);
    }

    this.assertReviewPeriod(
      dto.reviewPeriodStart ?? review.reviewPeriodStart,
      dto.reviewPeriodEnd ?? review.reviewPeriodEnd,
    );
    this.assertManagerStatus(dto.status, user, dto.employeeId ?? review.employeeId);

    return this.transaction(async (tx) => {
      const updated = await tx.performanceReview.update({
        where: { id },
        data: { ...dto, reviewerId },
        include: reviewInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'PerformanceReview', entityId: id, summary: 'Performance review updated', subjectEmployeeId: dto.employeeId ?? review.employeeId });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    const review = await this.ensureExists(id);
    await this.authorization.assertEmployeeScope(user, review.employeeId, { all: 'performance.hr.manage' });
    return this.transaction(async (tx) => {
      const removed = await tx.performanceReview.update({ where: { id }, data: { deletedAt: new Date() }, include: reviewInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'PerformanceReview', entityId: id, summary: 'Performance review archived', subjectEmployeeId: review.employeeId });
      return removed;
    });
  }

  private async accessWhere(user: RequestUser): Promise<Prisma.PerformanceReviewWhereInput> {
    const scopes: Prisma.PerformanceReviewWhereInput[] = [];
    for (const permission of ['performance.hr.manage', 'performance.read_all'] as const) {
      const rule = this.authorization.scopeRule(user, permission, AccessScopeType.ALL_EMPLOYEES);
      if (rule.unrestricted) {
        if (!rule.excludeIds.length) return {};
        scopes.push({ employeeId: { notIn: rule.excludeIds } });
      }
      else if (rule.includeIds.length) scopes.push({ employeeId: { in: rule.includeIds } });
    }
    if (user.employeeId && this.authorization.permissionAllowedForScope(user, 'performance.self.read', AccessScopeType.SELF, user.employeeId)) {
      scopes.push({ employeeId: user.employeeId, status: { not: ReviewStatus.DRAFT } });
    }
    if (user.employeeId && this.authorization.has(user, 'performance.team.read')) {
      const ids = (await this.prisma.employee.findMany({ where: { managerId: user.employeeId, deletedAt: null }, select: { id: true } }))
        .map(({ id }) => id)
        .filter((employeeId) => this.authorization.permissionAllowedForScope(user, 'performance.team.read', AccessScopeType.DIRECT_REPORTS, employeeId));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    if (user.employeeId && this.authorization.has(user, 'performance.management.read')) {
      const ids = (await this.authorization.managementTreeEmployeeIds(user.employeeId))
        .filter((employeeId) => this.authorization.permissionAllowedForScope(user, 'performance.management.read', AccessScopeType.MANAGEMENT_TREE, employeeId));
      if (ids.length) scopes.push({ employeeId: { in: ids } });
    }
    return scopes.length ? { OR: scopes } : { employeeId: '__no_review_scope__' };
  }

  private async assertCanReview(employeeId: string, user: RequestUser) {
    if (this.authorization.permissionAllowedForScope(user, 'performance.hr.manage', AccessScopeType.ALL_EMPLOYEES, employeeId)) return;
    if (!user.employeeId) {
      throw new ForbiddenException('Only managers and HR can create or update reviews');
    }
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null }, select: { managerId: true } });
    if (!employee) throw new NotFoundException('Record not found');
    if (employee.managerId === user.employeeId
      && this.authorization.permissionAllowedForScope(user, 'performance.team.manage', AccessScopeType.DIRECT_REPORTS, employeeId)) return;
    if (await this.authorization.isInManagementTree(user.employeeId, employeeId)
      && this.authorization.permissionAllowedForScope(user, 'performance.management.manage', AccessScopeType.MANAGEMENT_TREE, employeeId)) return;
    throw new NotFoundException('Record not found');
  }

  private async ensureEmployee(employeeId: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id: employeeId, deletedAt: null } });
    if (!employee) throw new NotFoundException('Employee not found');
  }

  private async ensureExists(id: string) {
    const review = await this.prisma.performanceReview.findFirst({ where: { id, deletedAt: null } });
    if (!review) throw new NotFoundException('Performance review not found');
    return review;
  }

  private assertReviewPeriod(start: Date, end: Date) {
    if (end < start) throw new BadRequestException('reviewPeriodEnd must be on or after reviewPeriodStart');
  }

  private assertManagerStatus(status: ReviewStatus | undefined, user: RequestUser, employeeId: string) {
    if (
      !this.authorization.permissionAllowedForScope(user, 'performance.hr.manage', AccessScopeType.ALL_EMPLOYEES, employeeId)
      && status
      && status !== ReviewStatus.DRAFT
      && status !== ReviewStatus.SUBMITTED
    ) {
      throw new ForbiddenException('Managers can only save draft or submitted reviews');
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
    throw new ConflictException('Performance review changed in another request. Try again.');
  }
}
