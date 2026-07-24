import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class GeneratePayrollDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiPropertyOptional({ description: 'Generate payroll for a single employee only' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: ['REGULAR', 'OFF_CYCLE'], default: 'REGULAR' })
  @IsOptional()
  @IsIn(['REGULAR', 'OFF_CYCLE'])
  runType?: 'REGULAR' | 'OFF_CYCLE';

  @ApiPropertyOptional({ description: 'Required for off-cycle payroll runs' })
  @IsOptional()
  @IsString()
  @MaxLength(240)
  purpose?: string;
}
