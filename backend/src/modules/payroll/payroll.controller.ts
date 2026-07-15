import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreatePayrollDto } from './dto/create-payroll.dto';
import { GeneratePayrollDto } from './dto/generate-payroll.dto';
import { QueryPayrollDto } from './dto/query-payroll.dto';
import { UpdatePayrollDto } from './dto/update-payroll.dto';
import { PayrollService } from './payroll.service';

@ApiTags('Payroll')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
@Controller('payroll')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post()
  create(@Body() dto: CreatePayrollDto) {
    return this.payrollService.create(dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post('generate')
  generate(@Body() dto: GeneratePayrollDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.generate(dto, user);
  }

  @Get()
  list(@Query() query: QueryPayrollDto, @CurrentUser() user: RequestUser) {
    return this.payrollService.list(query, user);
  }

  @ApiQuery({ name: 'year', type: Number })
  @ApiQuery({ name: 'month', type: Number })
  @Get('payslip/:employeeId')
  payslip(
    @Param('employeeId') employeeId: string,
    @Query() query: GeneratePayrollDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.payrollService.payslip(employeeId, query.year, query.month, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.findById(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePayrollDto) {
    return this.payrollService.update(id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.approve(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post(':id/mark-paid')
  markPaid(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.payrollService.markPaid(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.payrollService.remove(id);
  }
}
