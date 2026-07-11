import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
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

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post()
  create(@Body() dto: CreateLeaveBalanceDto) {
    return this.leaveService.createBalance(dto);
  }

  @Get()
  list(@Query() query: QueryLeaveBalancesDto, @CurrentUser() user: RequestUser) {
    return this.leaveService.listBalances(query, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.leaveService.findBalanceById(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveBalanceDto) {
    return this.leaveService.updateBalance(id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leaveService.removeBalance(id);
  }
}
