import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsDecimal, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

const asDecimalString = ({ value }: { value: unknown }) => String(value);

export class ImportEmployeeMasterDataRowDto {
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(50) employeeCode: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) fullName: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) company: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) wpsSponsor: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(200) designation: string;
  @ApiProperty() @IsString() @IsNotEmpty() @MaxLength(120) department: string;
  @ApiProperty() @IsDateString() joiningDate: string;
  @ApiProperty({ enum: ['Male', 'Female', 'Other'] }) @IsIn(['Male', 'Female', 'Other']) gender: 'Male' | 'Female' | 'Other';

  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) basic: string;
  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) hra: string;
  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) conveyance: string;
  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) mobile: string;
  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) food: string;
  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) fuel: string;
  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) other: string;
  @ApiProperty() @Transform(asDecimalString) @IsDecimal({ decimal_digits: '0,2', force_decimal: false }) grossSalary: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyConveyance?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyFuel?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyOther?: boolean;
}

export class ImportEmployeeMasterDataDto {
  @ApiProperty({ type: [ImportEmployeeMasterDataRowDto] })
  @IsArray() @ArrayMaxSize(5_000) @ValidateNested({ each: true }) @Type(() => ImportEmployeeMasterDataRowDto)
  rows: ImportEmployeeMasterDataRowDto[];
}
