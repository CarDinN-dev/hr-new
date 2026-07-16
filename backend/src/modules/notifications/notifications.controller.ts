import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { RequestUser } from '../../common/types/request-user.type';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications') @ApiBearerAuth() @Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}
  @Permissions('notification.self.read') @Get() list(@Query() query: PaginationQueryDto, @CurrentUser() user: RequestUser) { return this.service.list(query, user); }
  @Permissions('notification.self.manage') @Post(':id/read') read(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.service.markRead(id, user); }
  @Permissions('notification.self.manage') @Post('read-all') readAll(@CurrentUser() user: RequestUser) { return this.service.markAllRead(user); }
}
