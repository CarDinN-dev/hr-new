import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDate, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'Company Holiday' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Office will be closed next Monday.' })
  @IsString()
  @MaxLength(10_000)
  content: string;

  @ApiPropertyOptional({ type: 'array', items: { type: 'object' } })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsObject({ each: true })
  contentBlocks?: unknown[];

  @ApiPropertyOptional({ type: [String], example: ['EMPLOYEE', 'LINE_MANAGER'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Z][A-Z0-9_]{1,99}$/, { each: true })
  audienceRoles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  departmentId?: string | null;

  @ApiPropertyOptional({ example: '2026-07-09T08:00:00.000Z' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Date)
  @IsDate()
  publishedAt?: Date | null;

  @ApiPropertyOptional({ example: '2026-08-09T08:00:00.000Z' })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  emailEnabled?: boolean;
}
