import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryAnnouncementsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'EMPLOYEE' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{1,99}$/)
  audienceRole?: string;

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
