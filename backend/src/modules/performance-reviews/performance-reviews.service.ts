import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, ReviewStatus } from '@prisma/client';
import { hasPermission } from '../../common/authorization';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreatePerformanceReviewDto } from './dto/create-performance-review.dto';
import { QueryPerformanceReviewsDto } from './dto/query-performance-reviews.dto';
import { UpdatePerformanceReviewDto } from './dto/update-performance-review.dto';

const reviewInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  reviewer: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class PerformanceReviewsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async create(dto: CreatePerformanceReviewDto, user: RequestUser) {
    const hrManage = hasPermission(user, 'performance.hr.manage');
    const reviewerId = hrManage ? dto.reviewerId ?? user.employeeId : user.employeeId;
    if (!reviewerId) throw new NotFoundException('Reviewer employee profile is required');
    if (!hrManage && dto.reviewerId && dto.reviewerId !== reviewerId) {
      throw new ForbiddenException('Managers cannot submit reviews as another employee');
    }
    await this.ensureEmployee(dto.employeeId);
    await this.ensureEmployee(reviewerId);
    await this.assertCanReview(dto.employeeId, user);
    this.assertReviewPeriod(dto.reviewPeriodStart, dto.reviewPeriodEnd);
    this.assertManagerStatus(dto.status, user);
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.performanceReview.create({
        data: { ...dto, reviewerId },
        include: reviewInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.CREATE, entityType: 'PerformanceReview', entityId: review.id, summary: 'Performance review created' });
      return review;
    });
  }

  async list(query: QueryPerformanceReviewsDto, user: RequestUser) {
    const filters: Record<string, unknown>[] = [this.accessWhere(user)];
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
      where: { AND: [{ id }, { deletedAt: null }, this.accessWhere(user)] },
      include: reviewInclude,
    });
    if (!review) throw new NotFoundException('Performance review not found');
    return review;
  }

  async update(id: string, dto: UpdatePerformanceReviewDto, user: RequestUser) {
    const review = await this.ensureExists(id);
    await this.assertCanReview(review.employeeId, user);
    const hrManage = hasPermission(user, 'performance.hr.manage');
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
    this.assertManagerStatus(dto.status, user);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.performanceReview.update({
        where: { id },
        data: { ...dto, reviewerId },
        include: reviewInclude,
      });
      await this.audit.record(tx, user, { action: AuditAction.UPDATE, entityType: 'PerformanceReview', entityId: id, summary: 'Performance review updated' });
      return updated;
    });
  }

  async remove(id: string, user: RequestUser) {
    await this.ensureExists(id);
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.performanceReview.update({ where: { id }, data: { deletedAt: new Date() }, include: reviewInclude });
      await this.audit.record(tx, user, { action: AuditAction.DELETE, entityType: 'PerformanceReview', entityId: id, summary: 'Performance review archived' });
      return removed;
    });
  }

  private accessWhere(user: RequestUser) {
    if (hasPermission(user, 'performance.hr.manage')) return {};
    const scopes: Prisma.PerformanceReviewWhereInput[] = [];
    if (user.employeeId && hasPermission(user, 'performance.self.read')) scopes.push({ employeeId: user.employeeId });
    if (user.employeeId && hasPermission(user, 'performance.team.read')) scopes.push({ OR: [{ reviewerId: user.employeeId }, { employee: { managerId: user.employeeId } }] });
    if (hasPermission(user, 'performance.team.read') && user.departmentScopeIds.length) scopes.push({ employee: { departmentId: { in: user.departmentScopeIds } } });
    return scopes.length ? { OR: scopes } : { employeeId: '__no_review_scope__' };
  }

  private async assertCanReview(employeeId: string, user: RequestUser) {
    if (hasPermission(user, 'performance.hr.manage')) return;
    if (!user.employeeId || !hasPermission(user, 'performance.team.manage')) {
      throw new ForbiddenException('Only managers and HR can create or update reviews');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, deletedAt: null, OR: [{ managerId: user.employeeId }, { departmentId: { in: user.departmentScopeIds } }] },
    });
    if (!employee) throw new ForbiddenException('Managers can only review direct reports');
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

  private assertManagerStatus(status: ReviewStatus | undefined, user: RequestUser) {
    if (
      !hasPermission(user, 'performance.hr.manage')
      && status
      && status !== ReviewStatus.DRAFT
      && status !== ReviewStatus.SUBMITTED
    ) {
      throw new ForbiddenException('Managers can only save draft or submitted reviews');
    }
  }
}
