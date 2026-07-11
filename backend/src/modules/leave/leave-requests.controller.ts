import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
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

  @Post()
  create(@Body() dto: CreateLeaveRequestDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.createRequest(dto, user);
  }

  @Get()
  list(@Query() query: QueryLeaveRequestsDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.listRequests(query, user);
  }

  @Get('history/:employeeId')
  history(
    @Param('employeeId') employeeId: string,
    @Query() query: QueryLeaveRequestsDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.leaveService.history(employeeId, query, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.findRequestById(id, user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveRequestDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.updateRequest(id, dto, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER)
  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: DecideLeaveRequestDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.decideRequest(id, dto, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.cancelRequest(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leaveService.removeRequest(id);
  }
}
