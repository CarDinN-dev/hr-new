import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import {
  CreateCandidateDto, CreateEosDto, CreateExpenseDto, CreateRecruitmentJobDto, CreateTripDto,
  EmployeeScopedQueryDto, QueryRecruitmentDto, TransitionCandidateDto, TransitionEosDto,
  TransitionExpenseDto, TransitionTripDto, UpdateOrganizationSettingsDto,
} from './dto/operations.dto';
import { OperationsService } from './operations.service';

@ApiTags('HR Operations')
@ApiBearerAuth()
@Controller()
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Post('business-trips') createTrip(@Body() dto: CreateTripDto, @CurrentUser() user: RequestUser) { return this.operations.createTrip(dto, user); }
  @Get('business-trips') trips(@Query() query: EmployeeScopedQueryDto, @CurrentUser() user: RequestUser) { return this.operations.listTrips(query, user); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER)
  @Patch('business-trips/:id/status') tripStatus(@Param('id') id: string, @Body() dto: TransitionTripDto, @CurrentUser() user: RequestUser) { return this.operations.transitionTrip(id, dto, user); }
  @Delete('business-trips/:id') removeTrip(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeTrip(id, user); }

  @Post('expenses') createExpense(@Body() dto: CreateExpenseDto, @CurrentUser() user: RequestUser) { return this.operations.createExpense(dto, user); }
  @Get('expenses') expenses(@Query() query: EmployeeScopedQueryDto, @CurrentUser() user: RequestUser) { return this.operations.listExpenses(query, user); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER)
  @Patch('expenses/:id/status') expenseStatus(@Param('id') id: string, @Body() dto: TransitionExpenseDto, @CurrentUser() user: RequestUser) { return this.operations.transitionExpense(id, dto, user); }
  @Delete('expenses/:id') removeExpense(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeExpense(id, user); }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post('recruitment/jobs') createJob(@Body() dto: CreateRecruitmentJobDto, @CurrentUser() user: RequestUser) { return this.operations.createJob(dto, user); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Get('recruitment/jobs') jobs(@Query() query: QueryRecruitmentDto) { return this.operations.listJobs(query); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post('recruitment/candidates') createCandidate(@Body() dto: CreateCandidateDto, @CurrentUser() user: RequestUser) { return this.operations.createCandidate(dto, user); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Get('recruitment/candidates') candidates(@Query() query: QueryRecruitmentDto) { return this.operations.listCandidates(query); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch('recruitment/candidates/:id/stage') candidateStage(@Param('id') id: string, @Body() dto: TransitionCandidateDto, @CurrentUser() user: RequestUser) { return this.operations.transitionCandidate(id, dto, user); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete('recruitment/candidates/:id') removeCandidate(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeCandidate(id, user); }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post('eos') createEos(@Body() dto: CreateEosDto, @CurrentUser() user: RequestUser) { return this.operations.createEos(dto, user); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Get('eos') eos(@Query() query: EmployeeScopedQueryDto) { return this.operations.listEos(query); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch('eos/:id/status') eosStatus(@Param('id') id: string, @Body() dto: TransitionEosDto, @CurrentUser() user: RequestUser) { return this.operations.transitionEos(id, dto, user); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete('eos/:id') removeEos(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.operations.removeEos(id, user); }

  @Get('organization-settings') settings() { return this.operations.getSettings(); }
  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch('organization-settings') updateSettings(@Body() dto: UpdateOrganizationSettingsDto, @CurrentUser() user: RequestUser) { return this.operations.updateSettings(dto, user); }
}
