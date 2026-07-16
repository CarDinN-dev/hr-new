import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessScopeType, ApproverMode, LeaveApprovalStage, PermissionOverrideEffect, WorkflowType } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDate, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class SystemMutationDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion: number;
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class ChangeUserStatusDto {
  @ApiProperty() @IsBoolean() isActive: boolean;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedAuthorizationVersion: number;
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class CreateSystemUserDto {
  @ApiProperty() @IsEmail() @MaxLength(320) email: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() localLoginEnabled?: boolean;
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() microsoftLoginEnabled?: boolean;
  @ApiPropertyOptional({ minLength: 12, maxLength: 72 })
  @ValidateIf((dto: CreateSystemUserDto) => dto.localLoginEnabled === true || dto.password !== undefined)
  @IsString() @MinLength(12) @MaxLength(72) @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/u)
  password?: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsUUID('4', { each: true }) roleIds: string[];
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class UpdateSystemUserDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() localLoginEnabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() microsoftLoginEnabled?: boolean;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedAuthorizationVersion: number;
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class AssignUserRolesDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) roleIds: string[];
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedAuthorizationVersion: number;
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class CreateRoleDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z][A-Z0-9_]{2,99}$/u) code: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) displayName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) permissionIds?: string[];
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class UpdateRoleDto extends SystemMutationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(160) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ReplaceRolePermissionsDto extends SystemMutationDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) permissionIds: string[];
}

export class QuerySystemUsersDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsUUID() roleId?: string;
}

export class QuerySystemSessionsDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() active?: boolean;
}

export class RevokeSystemSessionDto {
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class CreatePermissionOverrideDto {
  @ApiProperty() @IsUUID() permissionId: string;
  @ApiProperty({ enum: PermissionOverrideEffect }) @IsEnum(PermissionOverrideEffect) effect: PermissionOverrideEffect;
  @ApiProperty({ enum: AccessScopeType }) @IsEnum(AccessScopeType) scopeType: AccessScopeType;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsString({ each: true }) @MaxLength(160, { each: true }) scopeIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsDate() @Transform(({ value }) => value ? new Date(value) : value) startsAt?: Date;
  @ApiPropertyOptional() @IsOptional() @IsDate() @Transform(({ value }) => value ? new Date(value) : value) expiresAt?: Date;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedAuthorizationVersion: number;
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class RevokePermissionOverrideDto extends SystemMutationDto {}

export class UpdateWorkflowPolicyDto extends SystemMutationDto {
  @ApiProperty({ enum: ApproverMode }) @IsEnum(ApproverMode) mode: ApproverMode;
  @ApiPropertyOptional() @IsOptional() @IsUUID() primaryUserId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(100) @ArrayUnique() @IsUUID('4', { each: true }) memberUserIds?: string[];
}

export class CreateWorkflowDelegationDto {
  @ApiProperty({ enum: WorkflowType }) @IsEnum(WorkflowType) workflowType: WorkflowType;
  @ApiProperty({ enum: LeaveApprovalStage }) @IsEnum(LeaveApprovalStage) stage: LeaveApprovalStage;
  @ApiProperty() @IsUUID() delegatorUserId: string;
  @ApiProperty() @IsUUID() delegateUserId: string;
  @ApiProperty() @IsDate() @Transform(({ value }) => new Date(value)) startsAt: Date;
  @ApiProperty() @IsDate() @Transform(({ value }) => new Date(value)) endsAt: Date;
  @ApiProperty({ minLength: 3, maxLength: 500 }) @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class RevokeWorkflowDelegationDto extends SystemMutationDto {}
