import { Module } from '@nestjs/common';
import { PayrollController } from './payroll.controller';
import { PayrollService } from './payroll.service';
import { SalaryRecordsController } from './salary-records.controller';
import { LoansModule } from '../loans/loans.module';
import { DocumentsModule } from '../documents/documents.module';

@Module({
  imports: [LoansModule, DocumentsModule],
  controllers: [PayrollController, SalaryRecordsController],
  providers: [PayrollService],
})
export class PayrollModule {}
