import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from 'class-validator';
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
