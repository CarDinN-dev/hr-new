import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateJobPositionDto } from './dto/create-job-position.dto';
import { QueryJobPositionsDto } from './dto/query-job-positions.dto';
import { UpdateJobPositionDto } from './dto/update-job-position.dto';
import { JobPositionsService } from './job-positions.service';

@ApiTags('Job Positions')
@ApiBearerAuth()
@Controller('job-positions')
export class JobPositionsController {
  constructor(private readonly jobPositionsService: JobPositionsService) {}

  @Permissions('position.manage')
  @Post()
  create(@Body() dto: CreateJobPositionDto, @CurrentUser() user: RequestUser) {
    return this.jobPositionsService.create(dto, user);
  }

  @Permissions('position.read')
  @Get()
  list(@Query() query: QueryJobPositionsDto) {
    return this.jobPositionsService.list(query);
  }

  @Permissions('position.read')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.jobPositionsService.findById(id);
  }

  @Permissions('position.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobPositionDto, @CurrentUser() user: RequestUser) {
    return this.jobPositionsService.update(id, dto, user);
  }

  @Permissions('position.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.jobPositionsService.remove(id, user);
  }
}
