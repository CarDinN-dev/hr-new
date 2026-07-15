import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateDepartmentDto } from './dto/create-department.dto';
import { QueryDepartmentsDto } from './dto/query-departments.dto';
import { UpdateDepartmentDto } from './dto/update-department.dto';
import { DepartmentsService } from './departments.service';

@ApiTags('Departments')
@ApiBearerAuth()
@Controller('departments')
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Permissions('department.manage')
  @Post()
  create(@Body() dto: CreateDepartmentDto, @CurrentUser() user: RequestUser) {
    return this.departmentsService.create(dto, user);
  }

  @Permissions('department.read')
  @Get()
  list(@Query() query: QueryDepartmentsDto) {
    return this.departmentsService.list(query);
  }

  @Permissions('department.read')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.departmentsService.findById(id);
  }

  @Permissions('department.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto, @CurrentUser() user: RequestUser) {
    return this.departmentsService.update(id, dto, user);
  }

  @Permissions('department.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.departmentsService.remove(id, user);
  }
}
