import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { LeaveService } from './leave.service';

@ApiTags('Leave Requests')
@ApiBearerAuth()
@Controller('leave/requests')
export class LeaveRequestsController {
  constructor(private readonly leaveService: LeaveService) {}

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.management.read', 'leave.hr.read', 'leave.audit.read', 'leave.read_all')
  @Get()
  list(@Query() query: QueryLeaveRequestsDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.listRequests(query, user);
  }

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.management.read', 'leave.hr.read', 'leave.audit.read', 'leave.read_all')
  @Get('history/:employeeId')
  history(
    @Param('employeeId') employeeId: string,
    @Query() query: QueryLeaveRequestsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leaveService.history(employeeId, query, user);
  }

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.management.read', 'leave.hr.read', 'leave.audit.read', 'leave.read_all')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.findRequestById(id, user);
  }

}
