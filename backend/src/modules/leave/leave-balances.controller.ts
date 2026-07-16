import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateLeaveBalanceDto } from './dto/create-leave-balance.dto';
import { QueryLeaveBalancesDto } from './dto/query-leave-balances.dto';
import { UpdateLeaveBalanceDto } from './dto/update-leave-balance.dto';
import { LeaveService } from './leave.service';

@ApiTags('Leave Balances')
@ApiBearerAuth()
@Controller('leave/balances')
export class LeaveBalancesController {
  constructor(private readonly leaveService: LeaveService) {}

  @Permissions('leave.configure')
  @Post()
  create(@Body() dto: CreateLeaveBalanceDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.createBalance(dto, user);
  }

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.management.read', 'leave.hr.read', 'leave.audit.read', 'leave.read_all')
  @Get()
  list(@Query() query: QueryLeaveBalancesDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.listBalances(query, user);
  }

  @AnyPermission('leave.self.read', 'leave.team.read', 'leave.management.read', 'leave.hr.read', 'leave.audit.read', 'leave.read_all')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.findBalanceById(id, user);
  }

  @Permissions('leave.configure')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveBalanceDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.updateBalance(id, dto, user);
  }

  @Permissions('leave.configure')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.removeBalance(id, user);
  }
}
