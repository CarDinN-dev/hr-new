import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
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

  @Permissions('attendance.hr.manage')
  @Post()
  create(@Body() dto: CreateAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.create(dto, user);
  }

  @Permissions('attendance.self.create')
  @Post('check-in')
  checkIn(@Body() dto: CheckAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.checkIn(dto, user);
  }

  @Permissions('attendance.self.create')
  @Post('check-out')
  checkOut(@Body() dto: CheckAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.checkOut(dto, user);
  }

  @AnyPermission('attendance.team.read', 'attendance.management.read', 'attendance.hr.read', 'attendance.audit.read', 'attendance.read_all')
  @Get('reports/summary')
  report(@Query() query: QueryAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.report(query, user);
  }

  @AnyPermission('attendance.self.read', 'attendance.team.read', 'attendance.management.read', 'attendance.hr.read', 'attendance.audit.read', 'attendance.read_all')
  @Get()
  list(@Query() query: QueryAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.list(query, user);
  }

  @AnyPermission('attendance.self.read', 'attendance.team.read', 'attendance.management.read', 'attendance.hr.read', 'attendance.audit.read', 'attendance.read_all')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.attendanceService.findById(id, user);
  }

  @Permissions('attendance.hr.manage')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAttendanceDto, @CurrentUser() user: RequestUser) {
    return this.attendanceService.update(id, dto, user);
  }

  @Permissions('attendance.hr.manage')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.attendanceService.remove(id, user);
  }
}
