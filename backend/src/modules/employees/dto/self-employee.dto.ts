import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { UpdateEmployeeDetailsDto } from './update-employee-details.dto';

export class UpdateSelfBasicProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2_000) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) emergencyContactPhone?: string;
}

export class UpdateSelfBankDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) bankCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) accountNumber?: string;
}

export class UpdatePayrollBankDto extends UpdateSelfBankDto {}

export class UpdateHrSensitiveDetailsDto extends UpdateEmployeeDetailsDto {
  @ApiPropertyOptional({ example: '1992-04-15' }) @IsOptional() @Type(() => Date) @IsDate() dateOfBirth?: Date;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2_000) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) emergencyContactPhone?: string;
}
