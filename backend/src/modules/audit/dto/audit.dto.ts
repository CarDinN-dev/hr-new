import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessScopeType, AuditAction, AuditExportFormat, AuditOutcome } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDate, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAuditDto extends PaginationQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorUserId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(320) actorEmail?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) actorRoleCode?: string;
  @ApiPropertyOptional({ enum: AuditAction }) @IsOptional() @IsEnum(AuditAction) action?: AuditAction;
  @ApiPropertyOptional({ enum: AuditOutcome }) @IsOptional() @IsEnum(AuditOutcome) outcome?: AuditOutcome;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) module?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) resourceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) resourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectDepartmentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) workflowId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) workflowStage?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) workflowStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) payrollPeriod?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) requestType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) permissionCode?: string;
  @ApiPropertyOptional({ enum: AccessScopeType }) @IsOptional() @IsEnum(AccessScopeType) scopeType?: AccessScopeType;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) requestId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) correlationId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) sessionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) ipHash?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) changedField?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => new Date(value)) @IsDate() dateFrom?: Date;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => new Date(value)) @IsDate() dateTo?: Date;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() isOverride?: boolean;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() isSelfApproval?: boolean;
}

export class CreateAuditExportDto extends QueryAuditDto {
  @ApiProperty({ enum: AuditExportFormat }) @IsEnum(AuditExportFormat) format: AuditExportFormat;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) exportReason: string;
}

export class UpdateAuditPolicyDto {
  @ApiProperty() @IsBoolean() enabled: boolean;
  @ApiProperty({ minimum: 30 }) @IsInt() @Min(30) retentionDays: number;
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion: number;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

export class CreateLegalHoldDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(200) name: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) reason: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) resourceType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) resourceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) workflowId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectEmployeeId?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => new Date(value)) @IsDate() endsAt?: Date;
}

export class ReleaseLegalHoldDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
