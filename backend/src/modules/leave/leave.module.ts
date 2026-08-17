import { Module } from '@nestjs/common';
import { LeaveBalancesController } from './leave-balances.controller';
import { LeaveRequestsController } from './leave-requests.controller';
import { LeaveTypesController } from './leave-types.controller';
import { LeaveService } from './leave.service';
import { LeaveWorkflowController } from './leave-workflow.controller';
import { DocumentsModule } from '../documents/documents.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [DocumentsModule, NotificationsModule],
  controllers: [LeaveTypesController, LeaveBalancesController, LeaveRequestsController, LeaveWorkflowController],
  providers: [LeaveService],
})
export class LeaveModule {}
