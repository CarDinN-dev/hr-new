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
  @IsOptional() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  hra?: string;

  @ApiPropertyOptional({ example: '2000.00', type: String })
  @IsOptional() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  conveyance?: string;

  @ApiPropertyOptional({ example: '250.00', type: String })
  @IsOptional() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  mobile?: string;

  @ApiPropertyOptional({ example: '500.00', type: String })
  @IsOptional() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  food?: string;

  @ApiPropertyOptional({ example: '300.00', type: String })
  @IsOptional() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  fuel?: string;

  @ApiPropertyOptional({ example: '150.00', type: String })
  @IsOptional() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  other?: string;

  @ApiPropertyOptional({ example: '-100.00', type: String })
  @IsOptional() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  grossAdjustment?: string;

  @ApiPropertyOptional({ example: '5000.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  allowances?: string;

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
