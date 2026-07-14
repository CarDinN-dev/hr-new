import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateSalaryRecordDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: 75000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  baseSalary: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  allowances?: number;

  @ApiPropertyOptional({ example: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  deductions?: number;

  @ApiPropertyOptional({ example: 2500 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  bonuses?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  taxRate?: number;

  @ApiProperty({ example: '2026-01-01' })
  @Type(() => Date)
  @IsDate()
  effectiveFrom: Date;

  @ApiPropertyOptional({ example: '2026-12-31' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  effectiveTo?: Date;
}
