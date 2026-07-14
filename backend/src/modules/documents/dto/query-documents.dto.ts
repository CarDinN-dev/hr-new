import { ApiPropertyOptional } from '@nestjs/swagger';
import { DocumentVisibility } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryDocumentsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  documentType?: string;

  @ApiPropertyOptional({ enum: DocumentVisibility })
  @IsOptional()
  @IsEnum(DocumentVisibility)
  visibility?: DocumentVisibility;

  @ApiPropertyOptional({ example: '2026-01-01' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiringBefore?: Date;
}
