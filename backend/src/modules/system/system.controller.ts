import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions, SystemAdministratorOnly } from '../../common/decorators/permissions.decorator';
import { RequestUser } from '../../common/types/request-user.type';
import {
  AssignUserRolesDto, ChangeUserStatusDto, CreateRoleDto, CreateSystemUserDto, QuerySystemSessionsDto, QuerySystemUsersDto,
  CreatePermissionOverrideDto, CreateWorkflowDelegationDto, ReplaceRolePermissionsDto,
  RevokePermissionOverrideDto, RevokeSystemSessionDto, RevokeWorkflowDelegationDto,
  SystemMutationDto, UpdateRoleDto, UpdateSystemUserDto, UpdateWorkflowPolicyDto,
} from './dto/system.dto';
import { SystemService } from './system.service';

@ApiTags('System administration')
@ApiBearerAuth()
@Controller('system')
@SystemAdministratorOnly()
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Permissions('user.read') @Get('users') users(@Query() query: QuerySystemUsersDto, @CurrentUser() user: RequestUser) { return this.system.listUsers(query, user); }
  @Permissions('user.manage') @Post('users') createUser(@Body() dto: CreateSystemUserDto, @CurrentUser() user: RequestUser) { return this.system.createUser(dto, user); }
  @Permissions('user.read') @Get('users/:id/effective-permissions') effectivePermissions(@Param('id') id: string, @CurrentUser() user: RequestUser) { return this.system.effectivePermissions(id, user); }
  @Permissions('user.manage') @Patch('users/:id') updateUser(@Param('id') id: string, @Body() dto: UpdateSystemUserDto, @CurrentUser() user: RequestUser) { return this.system.updateUser(id, dto, user); }
  @Permissions('user.deactivate') @Patch('users/:id/status') status(@Param('id') id: string, @Body() dto: ChangeUserStatusDto, @CurrentUser() user: RequestUser) { return this.system.changeUserStatus(id, dto, user); }
  @Permissions('user.delete_soft') @Delete('users/:id') deleteUser(@Param('id') id: string, @Body() dto: SystemMutationDto, @CurrentUser() user: RequestUser) { return this.system.softDeleteUser(id, dto, user); }
  @Permissions('role.assign') @Put('users/:id/roles') roles(@Param('id') id: string, @Body() dto: AssignUserRolesDto, @CurrentUser() user: RequestUser) { return this.system.assignRoles(id, dto, user); }
  @Permissions('permission.assign') @Post('users/:id/overrides') createOverride(@Param('id') id: string, @Body() dto: CreatePermissionOverrideDto, @CurrentUser() user: RequestUser) { return this.system.createOverride(id, dto, user); }
  @Permissions('permission.assign') @Post('users/:id/overrides/:overrideId/revoke') revokeOverride(@Param('id') id: string, @Param('overrideId') overrideId: string, @Body() dto: RevokePermissionOverrideDto, @CurrentUser() user: RequestUser) { return this.system.revokeOverride(id, overrideId, dto, user); }

  @Permissions('role.read') @Get('roles') listRoles(@CurrentUser() user: RequestUser) { return this.system.listRoles(user); }
  @Permissions('role.manage') @Post('roles') createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: RequestUser) { return this.system.createRole(dto, user); }
  @Permissions('role.manage') @Patch('roles/:id') updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto, @CurrentUser() user: RequestUser) { return this.system.updateRole(id, dto, user); }
  @Permissions('role.manage') @Put('roles/:id/permissions') replacePermissions(@Param('id') id: string, @Body() dto: ReplaceRolePermissionsDto, @CurrentUser() user: RequestUser) { return this.system.replaceRolePermissions(id, dto, user); }
  @Permissions('role.manage') @Delete('roles/:id') deleteRole(@Param('id') id: string, @Body() dto: SystemMutationDto, @CurrentUser() user: RequestUser) { return this.system.deleteRole(id, dto, user); }

  @Permissions('permission.read') @Get('permissions') permissions(@Query() query: Record<string, unknown>, @CurrentUser() user: RequestUser) {
    if (Object.keys(query).length) throw new BadRequestException('The permissions catalogue does not support query parameters.');
    return this.system.listPermissions(user);
  }
  @Permissions('session.manage') @Get('sessions') sessions(@Query() query: QuerySystemSessionsDto, @CurrentUser() user: RequestUser) { return this.system.listSessions(query, user); }
  @Permissions('session.manage') @Post('sessions/revoke-all') revokeAllSessions(@Body() dto: RevokeSystemSessionDto, @CurrentUser() user: RequestUser) { return this.system.revokeAllSessions(dto, user); }
  @Permissions('session.manage') @Post('sessions/:id/revoke') revokeSession(@Param('id') id: string, @Body() dto: RevokeSystemSessionDto, @CurrentUser() user: RequestUser) { return this.system.revokeSession(id, dto, user); }

  @Permissions('workflow.policy.read') @Get('workflow-policy') workflowPolicies(@CurrentUser() user: RequestUser) { return this.system.listWorkflowPolicies(user); }
  @Permissions('workflow.policy.manage') @Put('workflow-policy/:workflowType/:stage') updateWorkflowPolicy(@Param('workflowType') workflowType: string, @Param('stage') stage: string, @Body() dto: UpdateWorkflowPolicyDto, @CurrentUser() user: RequestUser) { return this.system.updateWorkflowPolicy(workflowType, stage, dto, user); }
  @Permissions('workflow.delegation.read') @Get('delegations') delegations(@CurrentUser() user: RequestUser) { return this.system.listDelegations(user); }
  @Permissions('workflow.delegation.manage') @Post('delegations') createDelegation(@Body() dto: CreateWorkflowDelegationDto, @CurrentUser() user: RequestUser) { return this.system.createDelegation(dto, user); }
  @Permissions('workflow.delegation.manage') @Post('delegations/:id/revoke') revokeDelegation(@Param('id') id: string, @Body() dto: RevokeWorkflowDelegationDto, @CurrentUser() user: RequestUser) { return this.system.revokeDelegation(id, dto, user); }
}
