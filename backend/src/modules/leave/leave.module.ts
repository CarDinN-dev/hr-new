import { Module } from '@nestjs/common';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveService } from './leave.service';

@Module({
  controllers: [LeaveTypesController, LeaveBalancesController, LeaveRequestsController],
  providers: [LeaveService],
})
export class LeaveModule {}
