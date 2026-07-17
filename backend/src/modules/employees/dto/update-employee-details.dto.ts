import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class EmployeeProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) employeeCategory?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) workShift?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) company?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) sponsorName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) wpsSponsor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) gradeBand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) familyStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) leavePolicy?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() lastRejoinDate?: Date;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) businessUnit?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) workingCompanyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) costCentre?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) nationality?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) residenceProfession?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) visaType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) hireType?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() confirmationDate?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() esbDate?: Date;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) maritalStatus?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) officeMobile?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) personalMobile?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) dependents?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) bloodGroup?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) localBuilding?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) localStreet?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) localZone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) internationalApartment?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) internationalBuilding?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) internationalFloor?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) internationalStreet?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) internationalState?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) internationalCountry?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) internationalZipCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) emergencyRelationship?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) salaryPayType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) officeFileNumber?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) accessCardNumber?: string;
}

export class EmployeeBenefitsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) travelSector?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) travelCost?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) employeeTicketsPerYear?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) ticketBalancePercent?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) familyTickets?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyAccommodation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyTransportation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() overtimeEligible?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyFood?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() companyFuelCard?: boolean;
}

export class EmployeeCredentialDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
  @ApiPropertyOptional() @IsString() @MaxLength(100) type: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) profession?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) placeOfIssue?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() issueDate?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() expiryDate?: Date;
}

export class EmployeeEducationDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() id?: string;
  @ApiPropertyOptional() @IsString() @MaxLength(200) qualification: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1900) @Max(2200) yearOfPassing?: number;
}

export class UpdateEmployeeDetailsDto {
  @ApiPropertyOptional({ type: EmployeeProfileDto })
  @IsOptional() @ValidateNested() @Type(() => EmployeeProfileDto)
  profile?: EmployeeProfileDto;

  @ApiPropertyOptional({ type: EmployeeBenefitsDto })
  @IsOptional() @ValidateNested() @Type(() => EmployeeBenefitsDto)
  benefits?: EmployeeBenefitsDto;

  @ApiPropertyOptional({ type: [EmployeeCredentialDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => EmployeeCredentialDto)
  credentials?: EmployeeCredentialDto[];

  @ApiPropertyOptional({ type: [EmployeeEducationDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => EmployeeEducationDto)
  education?: EmployeeEducationDto[];
}
