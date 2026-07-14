import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateLeaveTypeDto {
  @ApiProperty({ example: 'Annual Leave' })
  @IsString()
  @MaxLength(150)
  name: string;

  @ApiProperty({ example: 'ANNUAL' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @ApiProperty({ example: 21 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(366)
  annualAllowanceDays: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requiresAttachment?: boolean;
}
