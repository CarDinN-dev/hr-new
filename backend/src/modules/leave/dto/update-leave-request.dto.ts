import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateLeaveRequestDto } from './create-leave-request.dto';

export class UpdateLeaveRequestDto extends PartialType(
  OmitType(CreateLeaveRequestDto, ['employeeId'] as const),
) {}
