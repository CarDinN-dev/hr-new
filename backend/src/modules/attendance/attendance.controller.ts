import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { AttendanceService } from './attendance.service';
import { CheckAttendanceDto } from './dto/check-attendance.dto';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { QueryAttendanceDto } from './dto/query-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';

@ApiTags('Attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendanceService: AttendanceService) {}

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Post()
  create(@Body() dto: CreateAttendanceDto) {
    return this.attendanceService.create(dto);
  }

  @Post('check-in')
  checkIn(@Body() dto: CheckAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.checkIn(dto, user);
  }

  @Post('check-out')
  checkOut(@Body() dto: CheckAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.checkOut(dto, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN, Role.MANAGER)
  @Get('reports/summary')
  report(@Query() query: QueryAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.report(query, user);
  }

  @Get()
  list(@Query() query: QueryAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.list(query, user);
  }

  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.attendanceService.findById(id, user);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAttendanceDto) {
    return this.attendanceService.update(id, dto);
  }

  @Roles(Role.SUPER_ADMIN, Role.HR_ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.attendanceService.remove(id);
  }
}
