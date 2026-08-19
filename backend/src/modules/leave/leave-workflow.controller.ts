import { Body, Controller, Get, Headers, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { LeaveDecisionDto, LeaveReasonDecisionDto, OverrideLeaveDto, ReassignLeaveStepDto } from './dto/leave-workflow.dto';
import { QueryLeaveRequestsDto } from './dto/query-leave-requests.dto';
import { UpdateLeaveRequestDto } from './dto/update-leave-request.dto';
import { LeaveService } from './leave.service';
import { leaveAttachmentUploadOptions } from '../documents/document-upload';

@ApiTags('Leave workflow')
@ApiBearerAuth()
@Controller('leave')
export class LeaveWorkflowController {
  constructor(private readonly leave: LeaveService) {}

  @ApiConsumes('application/json', 'multipart/form-data')
  @Permissions('leave.self.create') @Post('submit') @UseInterceptors(FileInterceptor('file', leaveAttachmentUploadOptions))
  submit(@Body() dto: CreateLeaveRequestDto, @UploadedFile() file: Express.Multer.File | undefined, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.createRequest(dto, key, user, file); }
  @Permissions('leave.self.create') @Post('preview') preview(@Body() dto: CreateLeaveRequestDto, @CurrentUser() user: RequestUser) { return this.leave.preview(dto, user); }
  @Permissions('leave.self.read') @Get('mine') mine(@Query() query: QueryLeaveRequestsDto, @CurrentUser() user: RequestUser) { return this.leave.listMine(query, user); }
  @AnyPermission('leave.team.approve_line_manager', 'leave.management.approve_manager', 'leave.hr.approve', 'leave.executive.approve_cpo', 'leave.executive.approve_coo', 'leave.executive.self_approve_coo')
  @Get('inbox') inbox(@Query() query: QueryLeaveRequestsDto, @CurrentUser() user: RequestUser) { return this.leave.inbox(query, user); }
  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.management.read', 'leave.hr.read', 'leave.read_all') @Get(':id/timeline') timeline(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.leave.timeline(id, user); }
  @Permissions('leave.reassign') @Get(':id/eligible-assignees') eligibleAssignees(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.leave.eligibleAssignees(id, user); }

  @AnyPermission('leave.team.approve_line_manager', 'leave.management.approve_manager', 'leave.hr.approve', 'leave.executive.approve_cpo', 'leave.executive.approve_coo')
  @Post(':id/approve') approve(@Param('id') id: string, @Body() dto: LeaveDecisionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.approve(id, dto, key, user); }
  @Permissions('leave.executive.self_approve_coo') @Post(':id/self-approve') selfApprove(@Param('id') id: string, @Body() dto: LeaveDecisionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.selfApprove(id, dto, key, user); }
  @AnyPermission('leave.team.approve_line_manager', 'leave.management.approve_manager', 'leave.hr.approve', 'leave.executive.approve_cpo', 'leave.executive.approve_coo')
  @Post(':id/reject') reject(@Param('id') id: string, @Body() dto: LeaveReasonDecisionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.reject(id, dto, key, user); }
  @AnyPermission('leave.team.approve_line_manager', 'leave.management.approve_manager', 'leave.hr.approve', 'leave.executive.approve_cpo', 'leave.executive.approve_coo')
  @Post(':id/return') returnForCorrection(@Param('id') id: string, @Body() dto: LeaveReasonDecisionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.returnForCorrection(id, dto, key, user); }
  @Permissions('leave.self.create') @Post(':id/resubmit') resubmit(@Param('id') id: string, @Body() dto: LeaveDecisionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.resubmit(id, dto, key, user); }
  @AnyPermission('leave.self.cancel', 'leave.hr.manage') @Post(':id/cancel') cancel(@Param('id') id: string, @Body() dto: LeaveReasonDecisionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.cancel(id, dto, key, user); }
  @Permissions('leave.reassign') @Post(':id/reassign') reassign(@Param('id') id: string, @Body() dto: ReassignLeaveStepDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.reassign(id, dto, key, user); }
  @AnyPermission('leave.override', 'leave.hr.override') @Post(':id/override') override(@Param('id') id: string, @Body() dto: OverrideLeaveDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.override(id, dto, key, user); }
  @ApiConsumes('application/json', 'multipart/form-data')
  @Permissions('leave.self.create') @Post(':id/correction') @UseInterceptors(FileInterceptor('file', leaveAttachmentUploadOptions))
  correction(@Param('id') id: string, @Body() dto: UpdateLeaveRequestDto, @UploadedFile() file: Express.Multer.File | undefined, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.leave.updateRequest(id, dto, key, user, file); }
  @ApiConsumes('multipart/form-data')
  @AnyPermission('leave.self.create', 'leave.hr.manage') @Post(':id/attachment') @UseInterceptors(FileInterceptor('file', leaveAttachmentUploadOptions))
  attachment(@Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @CurrentUser() user: RequestUser) { return this.leave.replaceAttachment(id, file, user); }
}
