import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateLoanDto, LoanOverrideDto, LoanStatusTransitionDto, ManualRepaymentDto, QueryLoansDto, UpdateLoanDto } from './dto/loan.dto';
import { LoansService } from './loans.service';

@ApiTags('Loans')
@ApiBearerAuth()
@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Permissions('loan.hr.manage')
  @Post()
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: RequestUser) {
    return this.loans.create(dto, user);
  }

  @Permissions('loan.hr.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLoanDto, @CurrentUser() user: RequestUser) {
    return this.loans.update(id, dto, user);
  }

  @AnyPermission('loan.self.read', 'loan.hr.read', 'loan.audit.read', 'loan.read_all')
  @Get()
  list(@Query() query: QueryLoansDto, @CurrentUser() user: RequestUser) {
    return this.loans.list(query, user);
  }

  @AnyPermission('loan.self.read', 'loan.hr.read', 'loan.audit.read', 'loan.read_all')
  @Get(':id')
  find(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.loans.find(id, user);
  }

  @Permissions('loan.hr.manage')
  @Patch(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.loans.activate(id, user);
  }

  @Permissions('loan.hr.manage')
  @Patch(':id/pause')
  pause(@Param('id') id: string, @Body() dto: LoanStatusTransitionDto, @CurrentUser() user: RequestUser) {
    return this.loans.pause(id, dto, user);
  }

  @Permissions('loan.hr.manage')
  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: LoanStatusTransitionDto, @CurrentUser() user: RequestUser) {
    return this.loans.cancel(id, dto, user);
  }

  @Permissions('loan.hr.manage')
  @Post(':id/overrides')
  override(@Param('id') id: string, @Body() dto: LoanOverrideDto, @CurrentUser() user: RequestUser) {
    return this.loans.setOverride(id, dto, user);
  }

  @Permissions('loan.hr.manage')
  @Post(':id/repayments')
  repay(@Param('id') id: string, @Body() dto: ManualRepaymentDto, @CurrentUser() user: RequestUser) {
    return this.loans.manualRepayment(id, dto, user);
  }
}
