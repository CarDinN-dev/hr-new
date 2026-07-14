import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

export class CreatePerformanceReviewDto {
  @ApiProperty()
  @IsUUID()
  employeeId: string;

  @ApiPropertyOptional({ description: 'Defaults to current employee profile for managers' })
  @IsOptional()
  @IsUUID()
  reviewerId?: string;

  @ApiProperty({ example: '2026-01-01' })
  @Type(() => Date)
  @IsDate()
  reviewPeriodStart: Date;

  @ApiProperty({ example: '2026-06-30' })
  @Type(() => Date)
  @IsDate()
  reviewPeriodEnd: Date;

  @ApiProperty({ example: 4.5 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  rating: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  goals?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  strengths?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  improvements?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  comments?: string;

  @ApiPropertyOptional({ enum: ReviewStatus })
  @IsOptional()
  @IsEnum(ReviewStatus)
  status?: ReviewStatus;
}
