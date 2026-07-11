import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateSalaryRecordDto } from './dto/create-salary-record.dto';
import { QuerySalaryRecordsDto } from './dto/query-salary-records.dto';
import { UpdateSalaryRecordDto } from './dto/update-salary-record.dto';
import { PayrollService } from './payroll.service';

@ApiTags('Salary Records')
@ApiBearerAuth()
@Controller('payroll/salary-records')
export class SalaryRecordsController {
  constructor(private readonly payrollService: PayrollService) {}

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post()
  create(@Body() dto: CreateSalaryRecordDto) {
    return this.payrollService.createSalaryRecord(dto);
  }

  @Get()
  list(@Query() query: QuerySalaryRecordsDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.listSalaryRecords(query, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.findSalaryRecordById(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalaryRecordDto) {
    return this.payrollService.updateSalaryRecord(id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.payrollService.removeSalaryRecord(id);
  }
}
