import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateServiceRequestDto, QueryServiceRequestsDto, ServiceRequestOverrideDto, ServiceRequestReasonDto, ServiceRequestTransitionDto } from './dto/service-request.dto';
import { ServiceRequestsService } from './service-requests.service';

@ApiTags('Service requests')
@ApiBearerAuth()
@Controller('service-requests')
export class ServiceRequestsController {
  constructor(private readonly service: ServiceRequestsService) {}

  @AnyPermission('service_request.self.create', 'service_request.hr.create_for_employee') @Post() create(@Body() dto: CreateServiceRequestDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.create(dto, key, user); }
  @AnyPermission('service_request.self.read', 'service_request.hr.read', 'service_request.read_all') @Get() list(@Query() query: QueryServiceRequestsDto, @CurrentUser() user: RequestUser) { return this.service.list(query, user); }
  @AnyPermission('service_request.self.read', 'service_request.hr.read', 'service_request.read_all') @Get(':id') find(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.service.findById(id, user); }
  @Permissions('service_request.hr.generate') @Post(':id/review') review(@Param('id') id: string, @Body() dto: ServiceRequestTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.review(id, dto, key, user); }
  @Permissions('service_request.hr.generate') @Post(':id/generate') generate(@Param('id') id: string, @Body() dto: ServiceRequestTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.generate(id, dto, key, user); }
  @Permissions('service_request.hr.generate') @Post(':id/submit-approval') submitApproval(@Param('id') id: string, @Body() dto: ServiceRequestTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.submitApproval(id, dto, key, user); }
  @Permissions('service_request.hr.approve') @Post(':id/approve') approve(@Param('id') id: string, @Body() dto: ServiceRequestTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.approve(id, dto, key, user); }
  @Permissions('service_request.hr.reject') @Post(':id/reject') reject(@Param('id') id: string, @Body() dto: ServiceRequestReasonDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.reject(id, dto, key, user); }
  @Permissions('service_request.hr.publish') @Post(':id/publish') publish(@Param('id') id: string, @Body() dto: ServiceRequestTransitionDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.publish(id, dto, key, user); }
  @AnyPermission('service_request.self.cancel', 'service_request.hr.reject') @Post(':id/cancel') cancel(@Param('id') id: string, @Body() dto: ServiceRequestReasonDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.cancel(id, dto, key, user); }
  @Permissions('service_request.hr.revoke') @Post(':id/revoke') revoke(@Param('id') id: string, @Body() dto: ServiceRequestReasonDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.revoke(id, dto, key, user); }
  @Permissions('service_request.override') @Post(':id/override') override(@Param('id') id: string, @Body() dto: ServiceRequestOverrideDto, @Headers('idempotency-key') key: string | undefined, @CurrentUser() user: RequestUser) { return this.service.override(id, dto, key, user); }
  @AnyPermission('service_request.self.download', 'service_request.pdf.download_all') @Get(':id/download') async download(@Param('id') id: string, @CurrentUser() user: RequestUser, @Res() response: Response) {
    const file = await this.service.download(id, user); response.setHeader('Content-Type', 'application/pdf'); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`); response.send(file.buffer);
  }
}
