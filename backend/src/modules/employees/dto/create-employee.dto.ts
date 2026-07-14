import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentStatus, Gender } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateEmployeeDto {
  @ApiProperty({ example: 'EMP-0001' })
  @IsString()
  @MaxLength(50)
  employeeCode: string;

  @ApiProperty({ example: 'Aisha' })
  @IsString()
  @MaxLength(100)
  firstName: string;

  @ApiProperty({ example: 'Khan' })
  @IsString()
  @MaxLength(100)
  lastName: string;

  @ApiProperty({ example: 'aisha.khan@example.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: '1992-04-15' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateOfBirth?: Date;

  @ApiPropertyOptional({ enum: Gender })
  @IsOptional()
  @IsEnum(Gender)
  gender?: Gender;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  address?: string;

  @ApiProperty({ example: '2024-01-10' })
  @Type(() => Date)
  @IsDate()
  hireDate: Date;

  @ApiPropertyOptional({ enum: EmploymentStatus })
  @IsOptional()
  @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  positionId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  managerId?: string;

  @ApiProperty({ example: 75000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  salary: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  emergencyContactPhone?: string;

  @ApiPropertyOptional({ description: 'Existing user id to link this employee profile to' })
  @IsOptional()
  @IsUUID()
  userId?: string;
}
