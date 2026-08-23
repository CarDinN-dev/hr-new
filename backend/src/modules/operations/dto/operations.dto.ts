import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { CandidateStage, EosStatus, ExpenseStatus, RecruitmentJobStatus, TripStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsDecimal, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
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

export class InterviewAssessmentDto {
  @IsOptional() @IsString() @Length(1, 200) candidateName?: string;
  @IsOptional() @IsString() @Length(1, 200) position?: string;
  @IsOptional() @IsString() @Length(1, 200) department?: string;
  @IsOptional() @Type(() => Date) @IsDate() date?: Date;
  @IsOptional() @IsString() @Length(1, 40) time?: string;
  @IsOptional() @IsString() @Length(1, 200) venue?: string;
  @IsOptional() @IsString() @Length(1, 200) hiringName?: string;
  @IsOptional() @IsString() @Length(1, 200) hiringDepartment?: string;
  @IsOptional() @IsString() @Length(1, 200) hiringPosition?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) greetingRating?: number;
  @IsOptional() @IsString() @Length(1, 2000) greetingRemarks?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) backgroundRating?: number;
  @IsOptional() @IsString() @Length(1, 2000) backgroundRemarks?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) technicalRating?: number;
  @IsOptional() @IsString() @Length(1, 2000) technicalRemarks?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) leadershipRating?: number;
  @IsOptional() @IsString() @Length(1, 2000) leadershipRemarks?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) overallRating?: number;
  @IsOptional() @IsString() @Length(1, 500) visaStatus?: string;
  @IsOptional() @IsString() @Length(1, 500) drivingLicense?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) currentSalary?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) expectedSalary?: number;
  @IsOptional() @Type(() => Date) @IsDate() expectedJoiningDate?: Date;
  @IsOptional() @IsString() @Length(1, 2000) interviewerComments?: string;
  @IsOptional() @IsString() @Length(1, 2000) managerComments?: string;
}

export class OfferDetailsDto {
  @IsOptional() @IsString() @Length(1, 200) candidateName?: string;
  @IsOptional() @IsString() @Length(1, 200) designation?: string;
  @IsOptional() @IsString() @Length(1, 200) lineOfBusiness?: string;
  @IsOptional() @Type(() => Date) @IsDate() issueDate?: Date;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) basic?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) hra?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) conveyance?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) otherAllowance?: number;
}

export class UpdateCandidateDto extends PartialType(CreateCandidateDto) {
  @ApiPropertyOptional({ type: InterviewAssessmentDto })
  @IsOptional() @ValidateNested() @Type(() => InterviewAssessmentDto) interviewAssessment?: InterviewAssessmentDto;
  @ApiPropertyOptional({ type: OfferDetailsDto })
  @IsOptional() @ValidateNested() @Type(() => OfferDetailsDto) offerDetails?: OfferDetailsDto;
}

export class AssessmentLeaseDto {
  @ApiProperty() @IsUUID() editorToken: string;
}

export class UpdateInterviewAssessmentDto extends AssessmentLeaseDto {
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
  @ApiProperty({ type: InterviewAssessmentDto }) @ValidateNested() @Type(() => InterviewAssessmentDto) interviewAssessment: InterviewAssessmentDto;
}

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
