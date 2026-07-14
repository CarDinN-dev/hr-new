import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LeaveRequestStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class DecideLeaveRequestDto {
  @ApiProperty({ enum: [LeaveRequestStatus.APPROVED, LeaveRequestStatus.REJECTED] })
  @IsEnum(LeaveRequestStatus)
  status: LeaveRequestStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  rejectionReason?: string;
}
