import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions, SuperAdminOnly } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { AuditService } from './audit.service';
import { CreateAuditExportDto, CreateLegalHoldDto, QueryAuditDto, ReleaseLegalHoldDto, UpdateAuditPolicyDto } from './dto/audit.dto';

@ApiTags('Audit history')
@ApiBearerAuth()
@Controller(['audit/events', 'audit-events'])
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Permissions('audit.read') @Get() list(@Query() query: QueryAuditDto, @CurrentUser() user: RequestUser) { return this.audit.list(query, user); }
  @Permissions('audit.read') @Get('verify-chain') verify(@CurrentUser() user: RequestUser) { return this.audit.verifyChain(user); }
  @Permissions('audit.export') @Post('exports') export(@Body() dto: CreateAuditExportDto, @CurrentUser() user: RequestUser) { return this.audit.createExport(dto, user); }
  @Permissions('audit.export') @Get('exports/:id/download') async download(@Param('id') id: string, @CurrentUser() user: RequestUser, @Res() response: Response) { const file = await this.audit.downloadExport(id, user); response.setHeader('Content-Type', file.contentType); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`); response.send(file.buffer); }
  @SuperAdminOnly() @Permissions('audit.configure') @Get('policy') policy(@CurrentUser() user: RequestUser) { return this.audit.policy(user); }
  @SuperAdminOnly() @Permissions('audit.configure') @Post('policy') updatePolicy(@Body() dto: UpdateAuditPolicyDto, @CurrentUser() user: RequestUser) { return this.audit.updatePolicy(dto, user); }
  @SuperAdminOnly() @Permissions('audit.configure') @Get('legal-holds') holds(@CurrentUser() user: RequestUser) { return this.audit.listLegalHolds(user); }
  @SuperAdminOnly() @Permissions('audit.configure') @Post('legal-holds') createHold(@Body() dto: CreateLegalHoldDto, @CurrentUser() user: RequestUser) { return this.audit.createLegalHold(dto, user); }
  @SuperAdminOnly() @Permissions('audit.configure') @Post('legal-holds/:id/release') releaseHold(@Param('id') id: string, @Body() dto: ReleaseLegalHoldDto, @CurrentUser() user: RequestUser) { return this.audit.releaseLegalHold(id, dto, user); }
  @Permissions('audit.read') @Get(':id') detail(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.audit.findById(id, user); }
}
