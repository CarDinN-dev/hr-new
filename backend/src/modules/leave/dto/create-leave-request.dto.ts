import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

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

  @ApiProperty({ example: 5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.5)
  totalDays: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reason?: string;
}
