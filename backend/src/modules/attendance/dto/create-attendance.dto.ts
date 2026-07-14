import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AttendanceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAttendanceDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: '2024-02-01' })
  @Type(() => Date)
  @IsDate()
  attendanceDate: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  checkIn?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  checkOut?: Date;

  @ApiPropertyOptional({ enum: AttendanceStatus })
  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
