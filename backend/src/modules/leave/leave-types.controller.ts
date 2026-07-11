import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateLeaveTypeDto } from './dto/create-leave-type.dto';
import { QueryLeaveTypesDto } from './dto/query-leave-types.dto';
import { UpdateLeaveTypeDto } from './dto/update-leave-type.dto';
import { LeaveService } from './leave.service';

@ApiTags('Leave Types')
@ApiBearerAuth()
@Controller('leave/types')
export class LeaveTypesController {
  constructor(private readonly leaveService: LeaveService) {}

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post()
  create(@Body() dto: CreateLeaveTypeDto) {
    return this.leaveService.createType(dto);
  }

  @Get()
  list(@Query() query: QueryLeaveTypesDto) {
    return this.leaveService.listTypes(query);
  }

  @Get(':id')
  findById(@Param('id') id: string) {
    return this.leaveService.findTypeById(id);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.leaveService.updateType(id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leaveService.removeType(id);
  }
}
