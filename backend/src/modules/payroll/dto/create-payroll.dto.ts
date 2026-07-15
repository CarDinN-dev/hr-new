import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDecimal, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

const asDecimalString = ({ value }: { value: unknown }) => String(value);

export class CreatePayrollDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

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

  @ApiProperty({ example: '75000.00', type: String })
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  baseSalary: string;

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

  @ApiPropertyOptional({ example: '800.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  taxAmount?: string;

}
