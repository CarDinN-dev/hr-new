import { PickType } from '@nestjs/swagger';
import { CreateLeaveBalanceDto } from './create-leave-balance.dto';

export class UpdateLeaveBalanceDto extends PickType(CreateLeaveBalanceDto, ['totalDays'] as const) {}
