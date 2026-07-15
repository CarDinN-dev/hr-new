import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import {
  AssignUserRolesDto, ChangeUserStatusDto, CreateRoleDto, QuerySystemSessionsDto, QuerySystemUsersDto,
  ReplaceRolePermissionsDto, RevokeSystemSessionDto, SystemMutationDto, UpdateRoleDto,
} from './dto/system.dto';
import { SystemService } from './system.service';

@ApiTags('System administration')
@ApiBearerAuth()
@Controller('system')
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Permissions('user.read') @Get('users') users(@Query() query: QuerySystemUsersDto) { return this.system.listUsers(query); }
  @Permissions('user.read') @Get('users/:id/effective-permissions') effectivePermissions(@Param('id') id: string) { return this.system.effectivePermissions(id); }
  @Permissions('user.manage') @Patch('users/:id/status') status(@Param('id') id: string, @Body() dto: ChangeUserStatusDto, @CurrentUser() user: RequestUser) { return this.system.changeUserStatus(id, dto, user); }
  @Permissions('role.assign_any') @Put('users/:id/roles') roles(@Param('id') id: string, @Body() dto: AssignUserRolesDto, @CurrentUser() user: RequestUser) { return this.system.assignRoles(id, dto, user); }

  @Permissions('role.read') @Get('roles') listRoles() { return this.system.listRoles(); }
  @Permissions('role.manage') @Post('roles') createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: RequestUser) { return this.system.createRole(dto, user); }
  @Permissions('role.manage') @Patch('roles/:id') updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: RequestUser) { return this.system.updateRole(id, dto, user); }
  @Permissions('role.manage') @Put('roles/:id/permissions') replacePermissions(@Param('id') id: string, @Body() dto: ReplaceRolePermissionsDto, @CurrentUser() user: RequestUser) { return this.system.replaceRolePermissions(id, dto, user); }
  @Permissions('role.manage') @Delete('roles/:id') deleteRole(@Param('id') id: string, @Body() dto: SystemMutationDto, @CurrentUser() user: RequestUser) { return this.system.deleteRole(id, dto, user); }

  @Permissions('permission.read') @Get('permissions') permissions() { return this.system.listPermissions(); }
  @Permissions('session.manage') @Get('sessions') sessions(@Query() query: QuerySystemSessionsDto) { return this.system.listSessions(query); }
  @Permissions('session.manage') @Post('sessions/:id/revoke') revokeSession(@Param('id') id: string, @Body() dto: RevokeSystemSessionDto, @CurrentUser() user: RequestUser) { return this.system.revokeSession(id, dto, user); }
}
