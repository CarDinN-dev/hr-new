import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsObject, IsOptional } from 'class-validator';

export class UpdateEmployeeDetailsDto {
  @ApiPropertyOptional() @IsOptional() @IsObject() profile?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() bankAccount?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() benefits?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsObject() salary?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsArray() credentials?: Array<Record<string, unknown>>;
  @ApiPropertyOptional() @IsOptional() @IsArray() education?: Array<Record<string, unknown>>;
}
