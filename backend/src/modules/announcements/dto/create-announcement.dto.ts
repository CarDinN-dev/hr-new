import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LegacyRole } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsBoolean, IsDate, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'Company Holiday' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Office will be closed next Monday.' })
  @IsString()
  @MaxLength(10_000)
  content: string;

  @ApiPropertyOptional({ enum: LegacyRole, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(LegacyRole, { each: true })
  audienceRoles?: LegacyRole[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ example: '2026-07-09T08:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  publishedAt?: Date;

  @ApiPropertyOptional({ example: '2026-08-09T08:00:00.000Z' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
