import { ApiPropertyOptional } from '@nestjs/swagger';
import { Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { UpdateEmployeeDetailsDto } from './update-employee-details.dto';

export class UpdateSelfBasicProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) firstName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2_000) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) emergencyContactPhone?: string;
  @ApiPropertyOptional({ description: 'A normalized JPEG data URL, or an empty string to remove it.' })
  @IsOptional() @IsString() @MaxLength(700_000) @Matches(/^$|^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
  profilePhoto?: string;
}

export class UpdatePayrollBankDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) bankCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) iban?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) accountNumber?: string;
}

export class UpdateHrSensitiveDetailsDto extends UpdateEmployeeDetailsDto {
  @ApiPropertyOptional({ example: '1992-04-15' }) @IsOptional() @Type(() => Date) @IsDate() dateOfBirth?: Date;
  @ApiPropertyOptional({ enum: Gender }) @IsOptional() @IsEnum(Gender) gender?: Gender;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2_000) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) emergencyContactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) emergencyContactPhone?: string;
}
