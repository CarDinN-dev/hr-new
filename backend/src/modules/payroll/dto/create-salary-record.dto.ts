import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsDecimal, IsOptional, IsUUID } from 'class-validator';

const asDecimalString = ({ value }: { value: unknown }) => String(value);

export class CreateSalaryRecordDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: '75000.00', type: String })
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  baseSalary: string;

  @ApiPropertyOptional({ example: '5000.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  allowances?: string;

  @ApiPropertyOptional({ example: '3000.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  housingAllowance?: string;

  @ApiPropertyOptional({ example: '500.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  foodAllowance?: string;

  @ApiPropertyOptional({ example: '250.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  mobileAllowance?: string;

  @ApiPropertyOptional({ example: '750.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  specialAllowance?: string;

  @ApiPropertyOptional({ example: '1000.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  deductions?: string;

  @ApiPropertyOptional({ example: '2500.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  bonuses?: string;

  @ApiPropertyOptional({ example: '1000.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  overtimeAmount?: string;

  @ApiPropertyOptional({ example: '10.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  taxRate?: string;

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
