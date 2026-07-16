import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDate, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateAnnouncementDto {
  @ApiProperty({ example: 'Company Holiday' })
  @IsString()
  @MaxLength(200)
  title: string;

  @ApiProperty({ example: 'Office will be closed next Monday.' })
  @IsString()
  @MaxLength(10_000)
  content: string;

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
