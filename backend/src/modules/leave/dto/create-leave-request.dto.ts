import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateLeaveRequestDto {
  @ApiPropertyOptional({ description: 'HR admins may submit a request for another employee' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiProperty()
  @IsUUID()
  leaveTypeId: string;

  @ApiProperty({ example: '2026-08-01' })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiProperty({ example: '2026-08-05' })
  @Type(() => Date)
  @IsDate()
  endDate: Date;

  @ApiPropertyOptional({ default: false, description: 'Allowed only when startDate and endDate are the same day' })
  @IsOptional()
  @IsBoolean()
  isHalfDay?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
