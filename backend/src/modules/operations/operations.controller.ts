import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import {
  CreateCandidateDto, CreateEosDto, CreateExpenseDto, CreateRecruitmentJobDto, CreateTripDto,
  EmployeeScopedQueryDto, HireCandidateDto, QueryRecruitmentDto, TransitionCandidateDto, TransitionEosDto,
  TransitionExpenseDto, TransitionTripDto, UpdateCandidateDto, UpdateOrganizationSettingsDto, UpdateRecruitmentJobDto,
} from './dto/operations.dto';
import { OperationsService } from './operations.service';

@ApiTags('HR Operations')
@ApiBearerAuth()
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @AnyPermission('trip.self.create', 'trip.hr.manage')
  @Post('business-trips') createTrip(@Body() dto: CreateTripDto, @CurrentUser() user: RequestUser) { return this.operations.createTrip(dto, user); }
  @AnyPermission('trip.self.read', 'trip.team.read', 'trip.management.read', 'trip.hr.read', 'trip.read_all')
  @Get('business-trips') trips(@Query() query: EmployeeScopedQueryDto, @CurrentUser() user: RequestUser) { return this.operations.listTrips(query, user); }
  @AnyPermission('trip.team.approve_manager', 'trip.management.approve_manager', 'trip.hr.manage')
  @Patch('business-trips/:id/status') tripStatus(@Param('id') id: string, @Body() dto: TransitionTripDto, @CurrentUser() user: RequestUser) { return this.operations.transitionTrip(id, dto, user); }
  @AnyPermission('trip.self.create', 'trip.hr.manage')
  @Delete('business-trips/:id') removeTrip(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeTrip(id, user); }

  @AnyPermission('expense.self.create', 'expense.hr.approve')
  @Post('expenses') createExpense(@Body() dto: CreateExpenseDto, @CurrentUser() user: RequestUser) { return this.operations.createExpense(dto, user); }
  @AnyPermission('expense.self.read', 'expense.team.read', 'expense.management.read', 'expense.hr.read', 'expense.read_all')
  @Get('expenses') expenses(@Query() query: EmployeeScopedQueryDto, @CurrentUser() user: RequestUser) { return this.operations.listExpenses(query, user); }
  @AnyPermission('expense.team.approve_manager', 'expense.management.approve_manager', 'expense.hr.approve')
  @Patch('expenses/:id/status') expenseStatus(@Param('id') id: string, @Body() dto: TransitionExpenseDto, @CurrentUser() user: RequestUser) { return this.operations.transitionExpense(id, dto, user); }
  @AnyPermission('expense.self.create', 'expense.hr.approve')
  @Delete('expenses/:id') removeExpense(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeExpense(id, user); }

  @Permissions('recruitment.manage')
  @Post('recruitment/jobs') createJob(@Body() dto: CreateRecruitmentJobDto, @CurrentUser() user: RequestUser) { return this.operations.createJob(dto, user); }
  @Permissions('recruitment.read')
  @Get('recruitment/jobs') jobs(@Query() query: QueryRecruitmentDto, @CurrentUser() user: RequestUser) { return this.operations.listJobs(query, user); }
  @Permissions('recruitment.manage')
  @Patch('recruitment/jobs/:id') updateJob(@Param('id') id: string, @Body() dto: UpdateRecruitmentJobDto, @CurrentUser() user: RequestUser) { return this.operations.updateJob(id, dto, user); }
  @Permissions('recruitment.manage')
  @Delete('recruitment/jobs/:id') removeJob(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeJob(id, user); }
  @Permissions('recruitment.manage')
  @Post('recruitment/candidates') createCandidate(@Body() dto: CreateCandidateDto, @CurrentUser() user: RequestUser) { return this.operations.createCandidate(dto, user); }
  @Permissions('recruitment.read')
  @Get('recruitment/candidates') candidates(@Query() query: QueryRecruitmentDto, @CurrentUser() user: RequestUser) { return this.operations.listCandidates(query, user); }
  @Permissions('recruitment.manage')
  @Patch('recruitment/candidates/:id') updateCandidate(@Param('id') id: string, @Body() dto: UpdateCandidateDto, @CurrentUser() user: RequestUser) { return this.operations.updateCandidate(id, dto, user); }
  @Permissions('recruitment.manage')
  @Patch('recruitment/candidates/:id/stage') candidateStage(@Param('id') id: string, @Body() dto: TransitionCandidateDto, @CurrentUser() user: RequestUser) { return this.operations.transitionCandidate(id, dto, user); }
  @Permissions('recruitment.manage')
  @Post('recruitment/candidates/:id/hire') hireCandidate(@Param('id') id: string, @Body() dto: HireCandidateDto, @CurrentUser() user: RequestUser) { return this.operations.hireCandidate(id, dto, user); }
  @Permissions('recruitment.manage')
  @Delete('recruitment/candidates/:id') removeCandidate(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeCandidate(id, user); }

  @Permissions('eos.manage')
  @Post('eos/preview') previewEos(@Body() dto: CreateEosDto, @CurrentUser() user: RequestUser) { return this.operations.previewEos(dto, user); }
  @Permissions('eos.manage')
  @Post('eos') createEos(@Body() dto: CreateEosDto, @CurrentUser() user: RequestUser) { return this.operations.createEos(dto, user); }
  @Permissions('eos.read')
  @Get('eos') eos(@Query() query: EmployeeScopedQueryDto, @CurrentUser() user: RequestUser) { return this.operations.listEos(query, user); }
  @Permissions('eos.manage')
  @Patch('eos/:id/status') eosStatus(@Param('id') id: string, @Body() dto: TransitionEosDto, @CurrentUser() user: RequestUser) { return this.operations.transitionEos(id, dto, user); }
  @Permissions('eos.manage')
  @Delete('eos/:id') removeEos(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeEos(id, user); }

  @Permissions('organization.read')
  @Get('organization-settings') settings(@CurrentUser() user: RequestUser) { return this.operations.getSettings(user); }
  @Permissions('system.configure')
  @Patch('organization-settings') updateSettings(@Body() dto: UpdateOrganizationSettingsDto, @CurrentUser() user: RequestUser) { return this.operations.updateSettings(dto, user); }
}
