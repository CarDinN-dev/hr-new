import { ApiProperty, ApiPropertyOptional, OmitType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { CreateSalaryRecordDto } from '../../payroll/dto/create-salary-record.dto';
import { CreateEmployeeDto } from './create-employee.dto';
import { UpdateHrSensitiveDetailsDto, UpdatePayrollBankDto } from './self-employee.dto';

export class ImportSalaryRecordDto extends OmitType(CreateSalaryRecordDto, ['employeeId'] as const) {}

export class ImportEmployeeRowDto extends CreateEmployeeDto {
  @ApiPropertyOptional({ description: 'Client-side identifier returned in the server ID map' })
  @IsOptional() @IsString() @MaxLength(200) sourceId?: string;

  @ApiPropertyOptional({ description: 'Stable alternative to managerId for rows in the same import' })
  @IsOptional() @IsString() @MaxLength(50) managerEmployeeCode?: string;

  @ApiPropertyOptional({ type: UpdateHrSensitiveDetailsDto })
  @IsOptional() @ValidateNested() @Type(() => UpdateHrSensitiveDetailsDto) details?: UpdateHrSensitiveDetailsDto;

  @ApiPropertyOptional({ type: UpdatePayrollBankDto })
  @IsOptional() @ValidateNested() @Type(() => UpdatePayrollBankDto) bank?: UpdatePayrollBankDto;

  @ApiPropertyOptional({ type: ImportSalaryRecordDto })
  @IsOptional() @ValidateNested() @Type(() => ImportSalaryRecordDto) salaryRecord?: ImportSalaryRecordDto;
}

export class ImportEmployeesDto {
  @ApiProperty({ type: [ImportEmployeeRowDto], maxItems: 5_000 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5_000) @ValidateNested({ each: true }) @Type(() => ImportEmployeeRowDto)
  rows: ImportEmployeeRowDto[];
}
