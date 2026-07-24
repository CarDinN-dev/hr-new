import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { ReconcilePayrollPaymentItemDto } from './payroll-adjustment.dto';

export class MarkPayrollPaidDto {
  @ApiProperty({ minimum: 1 }) @IsInt() @Min(1) expectedVersion: number;
  @ApiProperty({ minLength: 3, maxLength: 120, example: 'BANK-2026-07-001' }) @IsString() @MinLength(3) @MaxLength(120) paymentBatchReference: string;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class ReconcilePayrollPaymentsDto extends MarkPayrollPaidDto {
  @ApiProperty({ type: [ReconcilePayrollPaymentItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReconcilePayrollPaymentItemDto) payments: ReconcilePayrollPaymentItemDto[];
}
