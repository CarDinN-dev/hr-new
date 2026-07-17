import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CreateAttendanceDto } from './create-attendance.dto';

export class ImportAttendanceDto {
  @ApiProperty({ type: [CreateAttendanceDto], maxItems: 50_000 })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50_000) @ValidateNested({ each: true }) @Type(() => CreateAttendanceDto)
  rows: CreateAttendanceDto[];
}
