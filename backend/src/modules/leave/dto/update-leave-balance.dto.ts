import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateLeaveBalanceDto } from './create-leave-balance.dto';

export class UpdateLeaveBalanceDto extends PartialType(
  OmitType(CreateLeaveBalanceDto, ['employeeId', 'leaveTypeId', 'year'] as const),
) {}
