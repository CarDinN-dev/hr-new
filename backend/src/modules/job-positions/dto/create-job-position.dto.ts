import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateJobPositionDto {
  @ApiProperty({ example: 'HR Manager' })
  @IsString()
  @MaxLength(150)
  title: string;

  @ApiProperty({ example: 'HR-MGR' })
  @IsString()
  @MaxLength(50)
  code: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @ApiPropertyOptional({ example: 'L4' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  level?: string;
}
