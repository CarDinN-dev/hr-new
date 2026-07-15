import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { QueryLeaveTypesDto } from './dto/query-leave-types.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { LeaveService } from './leave.service';

@ApiTags('Leave Types')
@ApiBearerAuth()
@Controller('leave/types')
export class LeaveTypesController {
  constructor(private readonly leaveService: LeaveService) {}

  @Permissions('leave.configure')
  @Post()
  create(@Body() dto: CreateLeaveTypeDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.createType(dto, user);
  }

  @AnyPermission('leave.self.read', 'leave.configure')
  @Get()
  list(@Query() query: QueryLeaveTypesDto) {
    return this.leaveService.listTypes(query);
  }

  @AnyPermission('leave.self.read', 'leave.configure')
  @Get(':id')
  findById(@Param('id') id: string) {
    return this.leaveService.findTypeById(id);
  }

  @Permissions('leave.configure')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.updateType(id, dto, user);
  }

  @Permissions('leave.configure')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.removeType(id, user);
  }
}
