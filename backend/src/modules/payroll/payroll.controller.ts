import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { PayrollService } from './payroll.service';

@ApiTags('Payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Permissions('payroll.generate')
  @Post()
  create(@Body() dto: CreatePayrollDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.create(dto, user);
  }

  @Permissions('payroll.generate')
  @Post('generate')
  generate(@Body() dto: GeneratePayrollDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.generate(dto, user);
  }

  @AnyPermission('payroll.self.read_payslip', 'payroll.read', 'payroll.audit.read')
  @Get()
  list(@Query() query: QueryPayrollDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.list(query, user);
  }

  @ApiQuery({ name: 'year', type: Number })
  @ApiQuery({ name: 'month', type: Number })
  @AnyPermission('payroll.self.read_payslip', 'payroll.read', 'payroll.audit.read')
  @Get('payslip/:employeeId')
  payslip(
    @Param('employeeId') employeeId: string,
    @Query() query: GeneratePayrollDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.payrollService.payslip(employeeId, query.year, query.month, user);
  }

  @AnyPermission('payroll.self.read_payslip', 'payroll.read', 'payroll.audit.read')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.findById(id, user);
  }

  @Permissions('payroll.generate')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePayrollDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.update(id, dto, user);
  }

  @Permissions('payroll.approve')
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.approve(id, user);
  }

  @Permissions('payroll.mark_paid')
  @Post(':id/mark-paid')
  markPaid(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.markPaid(id, user);
  }

  @Permissions('payroll.generate')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.remove(id, user);
  }
}
