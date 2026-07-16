import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceRequestStatus, ServiceRequestType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CreateServiceRequestDto {
  @ApiProperty({ enum: ServiceRequestType }) @IsEnum(ServiceRequestType) requestType: ServiceRequestType;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectEmployeeId?: string;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) requesterComment?: string;
}

export class ServiceRequestTransitionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class ServiceRequestReasonDto extends ServiceRequestTransitionDto {
  @ApiProperty({ minLength: 3, maxLength: 2000 }) @IsString() @MinLength(3) @MaxLength(2000) declare reason: string;
}

export class ServiceRequestOverrideDto extends ServiceRequestReasonDto {
  @ApiProperty({ enum: [ServiceRequestStatus.APPROVED, ServiceRequestStatus.PUBLISHED, ServiceRequestStatus.REJECTED, ServiceRequestStatus.REVOKED] })
  @IsEnum(ServiceRequestStatus)
  targetStatus: ServiceRequestStatus;
}

export class QueryServiceRequestsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ServiceRequestType }) @IsOptional() @IsEnum(ServiceRequestType) requestType?: ServiceRequestType;
  @ApiPropertyOptional({ enum: ServiceRequestStatus }) @IsOptional() @IsEnum(ServiceRequestStatus) status?: ServiceRequestStatus;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectEmployeeId?: string;
}
