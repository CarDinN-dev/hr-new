import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { DecideLeaveRequestDto } from './dto/decide-leave-request.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { LeaveService } from './leave.service';

@ApiTags('Leave Requests')
@ApiBearerAuth()
@Controller('leave/requests')
export class LeaveRequestsController {
  constructor(private readonly leaveService: LeaveService) {}

  @AnyPermission('leave.self.create', 'leave.hr.manage')
  @Post()
  create(@Body() dto: CreateLeaveRequestDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.createRequest(dto, user);
  }

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.department.read', 'leave.hr.read', 'leave.audit.read')
  @Get()
  list(@Query() query: QueryLeaveRequestsDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.listRequests(query, user);
  }

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.department.read', 'leave.hr.read', 'leave.audit.read')
  @Get('history/:employeeId')
  history(
    @Param('employeeId') employeeId: string,
    @Query() query: QueryLeaveRequestsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leaveService.history(employeeId, query, user);
  }

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.department.read', 'leave.hr.read', 'leave.audit.read')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.findRequestById(id, user);
  }

  @AnyPermission('leave.self.create', 'leave.hr.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveRequestDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.updateRequest(id, dto, user);
  }

  @AnyPermission('leave.team.approve_manager', 'leave.department.approve_manager', 'leave.hr.approve')
  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: DecideLeaveRequestDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.decideRequest(id, dto, user);
  }

  @AnyPermission('leave.self.cancel', 'leave.hr.manage')
  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.cancelRequest(id, user);
  }

  @Permissions('leave.hr.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.removeRequest(id, user);
  }
}
