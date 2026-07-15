import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
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

  @Permissions('payroll.configure')
  @Post()
  create(@Body() dto: CreateSalaryRecordDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.createSalaryRecord(dto, user);
  }

  @Permissions('payroll.read_compensation')
  @Get()
  list(@Query() query: QuerySalaryRecordsDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.listSalaryRecords(query, user);
  }

  @Permissions('payroll.read_compensation')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.findSalaryRecordById(id, user);
  }

  @Permissions('payroll.configure')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSalaryRecordDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.updateSalaryRecord(id, dto, user);
  }

  @Permissions('payroll.configure')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.removeSalaryRecord(id, user);
  }
}
