import { Module } from '@nestjs/common';
import { EmploymentContractsController } from './employment-contracts.controller';
import { EmploymentContractsService } from './employment-contracts.service';

@Module({
  controllers: [EmploymentContractsController],
  providers: [EmploymentContractsService],
})
export class EmploymentContractsModule {}
