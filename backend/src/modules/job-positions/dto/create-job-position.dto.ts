import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateJobPositionDto {
  @ApiProperty({ example: 'HR Manager' })
  @IsString()
  title: string;

  @ApiProperty({ example: 'HR-MGR' })
  @IsString()
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'L4' })
  @IsOptional()
  @IsString()
  level?: string;
}
