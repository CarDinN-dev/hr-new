import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';
import { CreateLeaveRequestDto } from './create-leave-request.dto';

export class UpdateLeaveRequestDto extends PartialType(
  OmitType(CreateLeaveRequestDto, ['employeeId'] as const),
) {
  @ApiProperty({ minimum: 1 }) @Type(() => Number) @IsInt() @Min(1) expectedVersion: number;
}
