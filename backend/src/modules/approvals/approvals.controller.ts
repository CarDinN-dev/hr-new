import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { ApprovalsService } from './approvals.service';
@ApiTags('Approval inbox') @ApiBearerAuth() @Controller('approvals')
export class ApprovalsController {
  constructor(private readonly service: ApprovalsService) {}
  @AnyPermission('leave.team.approve_line_manager', 'leave.management.approve_manager', 'leave.hr.approve', 'leave.executive.approve_cpo', 'leave.executive.approve_coo', 'leave.executive.self_approve_coo', 'service_request.hr.approve', 'payroll.approve')
  @Get('inbox') inbox(@CurrentUser() user: RequestUser) { return this.service.inbox(user); }
}
