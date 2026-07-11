import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class CheckAttendanceDto {
  @ApiPropertyOptional({ description: 'HR admins may check in/out for a specific employee' })
  @IsOptional()
  @IsUUID()
  employeeId?: string;
}
