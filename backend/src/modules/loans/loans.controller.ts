import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateLoanDto, LoanOverrideDto, ManualRepaymentDto, QueryLoansDto } from './dto/loan.dto';
import { LoansService } from './loans.service';

@ApiTags('Loans')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
@Controller('loans')
export class LoansController {
  constructor(private readonly loans: LoansService) {}

  @Post()
  create(@Body() dto: CreateLoanDto, @CurrentUser() user: RequestUser) {
    return this.loans.create(dto, user);
  }

  @Get()
  list(@Query() query: QueryLoansDto) {
    return this.loans.list(query);
  }

  @Get(':id')
  find(@Param('id') id: string) {
    return this.loans.find(id);
  }

  @Patch(':id/activate')
  activate(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.loans.activate(id, user);
  }

  @Post(':id/overrides')
  override(@Param('id') id: string, @Body() dto: LoanOverrideDto, @CurrentUser() user: RequestUser) {
    return this.loans.setOverride(id, dto, user);
  }

  @Post(':id/repayments')
  repay(@Param('id') id: string, @Body() dto: ManualRepaymentDto, @CurrentUser() user: RequestUser) {
    return this.loans.manualRepayment(id, dto, user);
  }
}
