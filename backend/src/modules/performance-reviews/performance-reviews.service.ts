import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { hasHrAccess } from '../../common/constants/access.constants';
import { RequestUser } from '../../common/types/request-user.type';
import { listArgs, paginationMeta, softDelete } from '../../common/utils/crud.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePerformanceReviewDto } from './dto/create-performance-review.dto';
import { QueryPerformanceReviewsDto } from './dto/query-performance-reviews.dto';
import { UpdatePerformanceReviewDto } from './dto/update-performance-review.dto';

const reviewInclude = {
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true, managerId: true } },
  reviewer: { select: { id: true, employeeCode: true, firstName: true, lastName: true, email: true } },
};

@Injectable()
export class PerformanceReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePerformanceReviewDto, user: RequestUser) {
    const reviewerId = hasHrAccess(user.role) ? dto.reviewerId ?? user.employeeId : user.employeeId;
    if (!reviewerId) throw new NotFoundException('Reviewer employee profile is required');
    if (!hasHrAccess(user.role) && dto.reviewerId && dto.reviewerId !== reviewerId) {
      throw new ForbiddenException('Managers cannot submit reviews as another employee');
    }
    await this.ensureEmployee(dto.employeeId);
    await this.ensureEmployee(reviewerId);
    await this.assertCanReview(dto.employeeId, user);
    return this.prisma.performanceReview.create({
      data: { ...dto, reviewerId },
      include: reviewInclude,
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
    if (dto.employeeId) {
      await this.ensureEmployee(dto.employeeId);
      await this.assertCanReview(dto.employeeId, user);
    }

    let reviewerId = dto.reviewerId;
    if (!hasHrAccess(user.role)) {
      if (!user.employeeId) throw new NotFoundException('Reviewer employee profile is required');
      if (reviewerId && reviewerId !== user.employeeId) {
        throw new ForbiddenException('Managers cannot submit reviews as another employee');
      }
      reviewerId = user.employeeId;
    } else if (reviewerId) {
      await this.ensureEmployee(reviewerId);
    }

    return this.prisma.performanceReview.update({
      where: { id },
      data: { ...dto, reviewerId },
      include: reviewInclude,
    });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    return softDelete(this.prisma.performanceReview, id, 'Performance review');
  }

  private accessWhere(user: RequestUser) {
    if (hasHrAccess(user.role)) return {};
    if (!user.employeeId) return { employeeId: '__no_employee_profile__' };
    if (user.role === Role.MANAGER) {
      return {
        OR: [
          { employeeId: user.employeeId },
          { reviewerId: user.employeeId },
          { employee: { managerId: user.employeeId } },
        ],
      };
    }
    return { employeeId: user.employeeId };
  }

  private async assertCanReview(employeeId: string, user: RequestUser) {
    if (hasHrAccess(user.role)) return;
    if (!user.employeeId || user.role !== Role.MANAGER) {
      throw new ForbiddenException('Only managers and HR can create or update reviews');
    }
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, managerId: user.employeeId, deletedAt: null },
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
}
