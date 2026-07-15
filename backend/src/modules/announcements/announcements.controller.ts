import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { AnnouncementsService } from './announcements.service';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { QueryAnnouncementsDto } from './dto/query-announcements.dto';
import { UpdateAnnouncementDto } from './dto/update-announcement.dto';

@ApiTags('Announcements')
@ApiBearerAuth()
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Permissions('announcement.manage')
  @Post()
  create(@Body() dto: CreateAnnouncementDto, @CurrentUser() user: RequestUser) {
    return this.announcementsService.create(dto, user);
  }

  @Permissions('announcement.read')
  @Get()
  list(@Query() query: QueryAnnouncementsDto, @CurrentUser() user: RequestUser) {
    return this.announcementsService.list(query, user);
  }

  @Permissions('announcement.read')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.announcementsService.findById(id, user);
  }

  @Permissions('announcement.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAnnouncementDto, @CurrentUser() user: RequestUser) {
    return this.announcementsService.update(id, dto, user);
  }

  @Permissions('announcement.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.announcementsService.remove(id, user);
  }
}
