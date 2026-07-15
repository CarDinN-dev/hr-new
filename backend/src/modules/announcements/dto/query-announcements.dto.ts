import { ApiPropertyOptional } from '@nestjs/swagger';
import { LegacyRole } from '@prisma/client';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAnnouncementsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: LegacyRole })
  @IsOptional()
  @IsEnum(LegacyRole)
  audienceRole?: LegacyRole;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  isActive?: boolean;
}
