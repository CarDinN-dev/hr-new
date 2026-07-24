import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AnyPermission, Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { ImportEmployeeMasterDataDto } from './dto/import-employee-master-data.dto';
import { QueryEmployeesDto } from './dto/query-employees.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { UpdateHrSensitiveDetailsDto, UpdatePayrollBankDto, UpdateSelfBankDto, UpdateSelfBasicProfileDto } from './dto/self-employee.dto';
import { EmployeesService } from './employees.service';

@ApiTags('Employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Permissions('employee.hr.create')
  @Post()
  create(@Body() dto: CreateEmployeeDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.create(dto, user);
  }

  @Permissions('import.run', 'employee.hr.create', 'employee.hr.update', 'employee.hr.read_sensitive', 'department.manage', 'position.manage', 'payroll.configure')
  @Post('import-master-data')
  importMasterData(@Body() dto: ImportEmployeeMasterDataDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.importMasterData(dto, user);
  }

  @AnyPermission('employee.self.read', 'employee.team.read', 'employee.management.read', 'employee.hr.read', 'employee.read_all')
  @Get()
  list(@Query() query: QueryEmployeesDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.list(query, user);
  }

  @Permissions('employee.self.read')
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.employeesService.getMyProfile(user);
  }

  @Permissions('employee.self.update_basic')
  @Patch('me/basic')
  updateMyBasic(@Body() dto: UpdateSelfBasicProfileDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.updateSelfBasic(dto, user);
  }

  @Permissions('employee.self.update_bank')
  @Patch('me/bank')
  updateMyBank(@Body() dto: UpdateSelfBankDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.updateSelfBank(dto, user);
  }

  @Permissions('payroll.update_bank')
  @Patch(':id/bank')
  updatePayrollBank(@Param('id') id: string, @Body() dto: UpdatePayrollBankDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.updatePayrollBank(id, dto, user);
  }

  @AnyPermission('employee.self.read', 'employee.team.read', 'employee.management.read', 'employee.hr.read', 'employee.read_all')
  @Get(':id')
  findById(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.employeesService.findById(id, user);
  }

  @Permissions('employee.hr.update')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEmployeeDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.update(id, dto, user);
  }

  @Permissions('employee.hr.read_sensitive', 'employee.hr.update')
  @Patch(':id/details')
  updateDetails(@Param('id') id: string, @Body() dto: UpdateHrSensitiveDetailsDto, @CurrentUser() user: RequestUser) {
    return this.employeesService.updateDetails(id, dto, user);
  }

  @Permissions('employee.hr.terminate')
  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.employeesService.remove(id, user);
  }
}
