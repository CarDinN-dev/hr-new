import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryRecordsController } from './salary-records.controller';
import { LoansModule } from '../loans/loans.module';

@Module({
  imports: [LoansModule],
  controllers: [PayrollController, SalaryRecordsController],
  providers: [PayrollService],
})
export class PayrollModule {}
