import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContractStatus, ContractType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreateEmploymentContractDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ enum: ContractType })
  @IsEnum(ContractType)
  contractType: ContractType;

  @ApiProperty({ example: '2024-01-01' })
  @Type(() => Date)
  @IsDate()
  startDate: Date;

  @ApiPropertyOptional({ example: '2025-01-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endDate?: Date;

  @ApiProperty({ example: 75000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  salary: number;

  @ApiPropertyOptional({ example: 'USD' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiPropertyOptional({ default: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(168)
  workingHoursPerWeek?: number;

  @ApiPropertyOptional({ enum: ContractStatus })
  @IsOptional()
  @IsEnum(ContractStatus)
  status?: ContractStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  terms?: string;
}
