import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDecimal, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, MaxLength, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const decimal = ({ value }: { value: unknown }) => String(value);
const boolean = ({ value }: { value: unknown }) => value === true || value === 'true';

export class CreatePayrollAdjustmentDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty({ example: 2026 }) @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year: number;
  @ApiProperty({ example: 7 }) @Type(() => Number) @IsInt() @Min(1) @Max(12) month: number;
  @ApiProperty({ enum: ['EARNING', 'DEDUCTION'] }) @IsIn(['EARNING', 'DEDUCTION']) direction: 'EARNING' | 'DEDUCTION';
  @ApiProperty({ type: String, example: '250.00' }) @Transform(decimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) amount: string;
  @ApiPropertyOptional({ default: false }) @IsOptional() @Transform(boolean) @IsBoolean() taxable?: boolean;
  @ApiProperty({ example: 'Approved overtime correction' }) @IsString() @Length(3, 240) description: string;
  @ApiProperty({ example: 'Approved by HR after attendance correction' }) @IsString() @Length(3, 1000) reason: string;
}

export class QueryPayrollAdjustmentsDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2000) @Max(2100) year?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(12) month?: number;
  @IsOptional() @Transform(boolean) @IsBoolean() applied?: boolean;
}

export class ReconcilePayrollPaymentItemDto {
  @ApiProperty() @IsUUID() payrollId: string;
  @ApiProperty({ enum: ['PAID', 'FAILED'] }) @IsIn(['PAID', 'FAILED']) status: 'PAID' | 'FAILED';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) paymentReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) failureReason?: string;
}
