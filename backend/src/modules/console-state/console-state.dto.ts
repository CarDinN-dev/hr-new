import { ApiProperty } from '@nestjs/swagger';
import { IsISO8601, IsObject, IsOptional } from 'class-validator';

export class SaveConsoleStateDto {
  @ApiProperty({ description: 'Full HR console state JSON' })
  @IsObject()
  data: Record<string, unknown>;

  @ApiProperty({ required: false, description: 'Last loaded updatedAt value for overwrite protection' })
  @IsOptional()
  @IsISO8601()
  updatedAt?: string;
}
