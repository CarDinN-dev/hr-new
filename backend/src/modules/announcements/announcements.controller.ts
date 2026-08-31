import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { announcementAttachmentUploadOptions } from '../documents/document-upload';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';
import { UploadAnnouncementAttachmentDto } from './dto/upload-announcement-attachment.dto';

@ApiTags('Announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @AnyPermission('announcement.manage', 'announcement.department.manage')
  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: RequestUser) {
    return this.announcementsService.create(dto, user);
  }

  @AnyPermission('announcement.read', 'announcement.manage', 'announcement.department.manage')
  @Get()
  list(@Query() query: QueryAnnouncementsDto, @CurrentUser() user: RequestUser) {
    return this.announcementsService.list(query, user);
  }

  @ApiConsumes('multipart/form-data')
  @AnyPermission('announcement.manage', 'announcement.department.manage')
  @Post(':id/attachments')
  @UseInterceptors(FileInterceptor('file', announcementAttachmentUploadOptions))
  uploadAttachment(@Param('id') id: string, @Body() dto: UploadAnnouncementAttachmentDto, @UploadedFile() file: Express.Multer.File, @CurrentUser() user: RequestUser) {
    return this.announcementsService.uploadAttachment(id, dto, file, user);
  }

  @AnyPermission('announcement.manage', 'announcement.department.manage')
  @Delete(':id/attachments/:attachmentId')
  removeAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentUser() user: RequestUser) {
    return this.announcementsService.removeAttachment(id, attachmentId, user);
  }

  @AnyPermission('announcement.read', 'announcement.manage', 'announcement.department.manage')
  @Get(':id/attachments/:attachmentId/download')
  async downloadAttachment(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @CurrentUser() user: RequestUser, @Res() response: Response) {
    const file = await this.announcementsService.attachmentContent(id, attachmentId, user);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `${file.kind === 'INLINE_IMAGE' ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    response.setHeader('Cache-Control', 'private, no-store, max-age=0');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.send(file.buffer);
  }

  @AnyPermission('announcement.manage', 'announcement.department.manage')
  @Post(':id/publish')
  publish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.announcementsService.publish(id, user);
  }

  @AnyPermission('announcement.manage', 'announcement.department.manage')
  @Get(':id/delivery-status')
  deliveryStatus(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.announcementsService.deliveryStatus(id, user);
  }

  @AnyPermission('announcement.read', 'announcement.manage', 'announcement.department.manage')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.announcementsService.findById(id, user);
  }

  @AnyPermission('announcement.manage', 'announcement.department.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto, @CurrentUser() user: RequestUser) {
    return this.announcementsService.update(id, dto, user);
  }

  @AnyPermission('announcement.manage', 'announcement.department.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.announcementsService.remove(id, user);
  }
}
