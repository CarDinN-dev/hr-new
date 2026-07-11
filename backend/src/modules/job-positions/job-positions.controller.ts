import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateJobPositionDto } from './dto/create-job-position.dto';
import { QueryJobPositionsDto } from './dto/query-job-positions.dto';
import { UpdateJobPositionDto } from './dto/update-job-position.dto';
import { JobPositionsService } from './job-positions.service';

@ApiTags('Job Positions')
@ApiBearerAuth()
@Controller('job-positions')
export class JobPositionsController {
  constructor(private readonly jobPositionsService: JobPositionsService) {}

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post()
  create(@Body() dto: CreateJobPositionDto) {
    return this.jobPositionsService.create(dto);
  }

  @Get()
  list(@Query() query: QueryJobPositionsDto) {
    return this.jobPositionsService.list(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.jobPositionsService.findById(id);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobPositionDto) {
    return this.jobPositionsService.update(id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.jobPositionsService.remove(id);
  }
}
