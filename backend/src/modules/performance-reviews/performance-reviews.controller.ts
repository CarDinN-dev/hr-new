import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreatePerformanceReviewDto } from './dto/create-performance-review.dto';
import { QueryPerformanceReviewsDto } from './dto/query-performance-reviews.dto';
import { UpdatePerformanceReviewDto } from './dto/update-performance-review.dto';
import { PerformanceReviewsService } from './performance-reviews.service';

@ApiTags('Performance Reviews')
@ApiBearerAuth()
@Controller('performance-reviews')
export class PerformanceReviewsController {
  constructor(private readonly reviewsService: PerformanceReviewsService) {}

  @AnyPermission('performance.team.manage', 'performance.management.manage', 'performance.hr.manage')
  @Post()
  create(@Body() dto: CreatePerformanceReviewDto, @CurrentUser() user: RequestUser) {
    return this.reviewsService.create(dto, user);
  }

  @AnyPermission('performance.self.read', 'performance.team.read', 'performance.management.read', 'performance.hr.manage', 'performance.read_all')
  @Get()
  list(@Query() query: QueryPerformanceReviewsDto, @CurrentUser() user: RequestUser) {
    return this.reviewsService.list(query, user);
  }

  @AnyPermission('performance.self.read', 'performance.team.read', 'performance.management.read', 'performance.hr.manage', 'performance.read_all')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.reviewsService.findById(id, user);
  }

  @AnyPermission('performance.team.manage', 'performance.management.manage', 'performance.hr.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePerformanceReviewDto, @CurrentUser() user: RequestUser) {
    return this.reviewsService.update(id, dto, user);
  }

  @Permissions('performance.hr.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.reviewsService.remove(id, user);
  }
}
