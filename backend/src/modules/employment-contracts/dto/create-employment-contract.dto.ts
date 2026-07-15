import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ContractStatus, ContractType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsDecimal, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

const asDecimalString = ({ value }: { value: unknown }) => String(value);

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

  @ApiProperty({ type: String, example: '75000.00' })
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  salary: string;

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
