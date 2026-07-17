import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { LoanRepaymentMode, LoanStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsDecimal,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const asDecimalString = ({ value }: { value: unknown }) => String(value);

export class CreateLoanDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiProperty({ example: 'Salary advance' })
  @IsString()
  @Length(1, 100)
  type: string;

  @ApiProperty({ example: '12000.00', type: String })
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  principal: string;

  @ApiProperty({ example: '2026-07-01' })
  @Type(() => Date)
  @IsDate()
  disbursementDate: Date;

  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  startYear: number;

  @ApiProperty({ example: 8 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  startMonth: number;

  @ApiProperty({ enum: LoanRepaymentMode })
  @IsEnum(LoanRepaymentMode)
  repaymentMode: LoanRepaymentMode;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(600)
  termMonths?: number;

  @ApiPropertyOptional({ example: '1000.00', type: String })
  @IsOptional()
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  monthlyLimit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 100)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  notes?: string;
}

export class UpdateLoanDto extends PartialType(OmitType(CreateLoanDto, ['employeeId'] as const)) {}

export class LoanStatusTransitionDto {
  @ApiProperty()
  @IsString()
  @Length(3, 500)
  reason: string;
}

export class QueryLoansDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional({ enum: LoanStatus })
  @IsOptional()
  @IsEnum(LoanStatus)
  status?: LoanStatus;
}

export class LoanOverrideDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 8 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: '750.00', type: String })
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  amount: string;

  @ApiProperty()
  @IsString()
  @Length(3, 500)
  reason: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  approvedAboveLimit?: boolean;
}

export class ManualRepaymentDto {
  @ApiProperty({ example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year: number;

  @ApiProperty({ example: 8 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @ApiProperty({ example: '500.00', type: String })
  @Transform(asDecimalString)
  @IsDecimal({ decimal_digits: '0,2', force_decimal: false })
  amount: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 500)
  note?: string;
}
