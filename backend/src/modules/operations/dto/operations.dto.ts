import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CandidateStage, EosStatus, ExpenseStatus, RecruitmentJobStatus, TripStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsDecimal, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

const asDecimal = ({ value }: { value: unknown }) => String(value);
const emptyToNull = ({ value }: { value: unknown }) => value === '' ? null : value;

export class EmployeeScopedQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() employeeId?: string;
  @IsOptional() @IsString() status?: string;
}

export class CreateTripDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiProperty() @IsString() @Length(1, 120) destination: string;
  @ApiProperty() @IsString() @Length(3, 1000) purpose: string;
  @ApiProperty() @Type(() => Date) @IsDate() startDate: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endDate: Date;
  @ApiPropertyOptional({ type: String }) @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) perDiem?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) travelCost?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) advanceAmount?: string;
}

export class CreateExpenseDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() tripId?: string;
  @ApiProperty() @IsString() @Length(1, 100) category: string;
  @ApiProperty() @Type(() => Date) @IsDate() expenseDate: Date;
  @ApiProperty({ type: String }) @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) amount: string;
  @ApiProperty() @IsString() @Length(3, 1000) description: string;
}

export class TransitionTripDto {
  @ApiProperty({ enum: TripStatus }) @IsEnum(TripStatus) status: TripStatus;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}
export class TransitionExpenseDto {
  @ApiProperty({ enum: ExpenseStatus }) @IsEnum(ExpenseStatus) status: ExpenseStatus;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}

export class CreateRecruitmentJobDto {
  @ApiProperty() @IsString() @Length(1, 150) title: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() departmentId?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) openings?: number;
  @ApiProperty() @Type(() => Date) @IsDate() postedOn: Date;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 5000) description?: string;
}

export class UpdateRecruitmentJobDto extends PartialType(CreateRecruitmentJobDto) {
  @ApiPropertyOptional({ enum: RecruitmentJobStatus }) @IsOptional() @IsEnum(RecruitmentJobStatus) status?: RecruitmentJobStatus;
}

export class CreateCandidateDto {
  @ApiProperty() @IsUUID() jobId: string;
  @ApiProperty() @IsString() @Length(1, 200) name: string;
  @ApiProperty() @IsEmail() email: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 40) phone?: string;
  @ApiPropertyOptional({ type: String }) @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) rating?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 2000) notes?: string;
  @ApiProperty() @Type(() => Date) @IsDate() appliedOn: Date;
}

export class UpdateCandidateDto extends PartialType(CreateCandidateDto) {}

export class TransitionCandidateDto {
  @ApiProperty({ enum: CandidateStage }) @IsEnum(CandidateStage) stage: CandidateStage;
  @ApiPropertyOptional() @IsOptional() @IsUUID() employeeId?: string;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}

export class QueryRecruitmentDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() jobId?: string;
  @IsOptional() @IsEnum(CandidateStage) stage?: CandidateStage;
  @IsOptional() @IsEnum(RecruitmentJobStatus) status?: RecruitmentJobStatus;
}

export class CreateEosDto {
  @ApiProperty() @IsUUID() employeeId: string;
  @ApiProperty() @Type(() => Date) @IsDate() asOf: Date;
  @ApiProperty() @IsString() @Length(3, 1000) reason: string;
}

export class TransitionEosDto {
  @ApiProperty({ enum: EosStatus }) @IsEnum(EosStatus) status: EosStatus;
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}

class OrganizationSettingsInput {
  @IsString() @Length(1, 200) name: string;
  @IsString() @Length(1, 300) legalName: string;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 500) tagline?: string | null;
  @IsOptional() @IsString() @Length(1, 20) currency?: string;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 300) address?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsEmail() email?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 40) phone?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 300) website?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 100) wpsEmployerEid?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 100) wpsPayerEid?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 100) wpsPayerQid?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 100) wpsPayerBank?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @Length(1, 100) wpsPayerIban?: string | null;
  @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) workdayHours?: string;
  @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) halfDayHours?: string;
  @IsOptional() @IsIn(['AMOUNT', 'PERCENT']) loanCapType?: 'AMOUNT' | 'PERCENT';
  @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) loanCapValue?: string;
  @IsOptional() @IsIn(['FIXED_30', 'CALENDAR_DAYS']) payrollProrationBasis?: 'FIXED_30' | 'CALENDAR_DAYS';
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() payrollRequireBankDetails?: boolean;
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() payrollRequireAttendance?: boolean;
  @IsOptional() @Transform(asDecimal) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) payrollVarianceThreshold?: string;
}

export class UpdateOrganizationSettingsDto extends PartialType(OrganizationSettingsInput) {
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}
