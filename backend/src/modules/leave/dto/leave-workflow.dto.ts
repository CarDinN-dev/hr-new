import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeaveRequestStatus } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class LeaveDecisionDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion: number;
  @ApiPropertyOptional({ maxLength: 2000 }) @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}

export class LeaveReasonDecisionDto extends LeaveDecisionDto {
  @ApiProperty({ minLength: 3, maxLength: 2000 }) @IsString() @MinLength(3) @MaxLength(2000) declare reason: string;
}

export class ReassignLeaveStepDto extends LeaveReasonDecisionDto {
  @ApiProperty() @IsUUID() assigneeUserId: string;
}

export class OverrideLeaveDto extends LeaveReasonDecisionDto {
  @ApiProperty({ enum: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED, LeaveRequestStatus.CANCELLED] })
  @IsEnum(LeaveRequestStatus)
  targetStatus: LeaveRequestStatus;
}
