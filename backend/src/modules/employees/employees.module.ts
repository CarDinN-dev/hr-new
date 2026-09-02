import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { MicrosoftDirectoryProvisioningService } from '../system/microsoft-directory-provisioning.service';

@Module({
  controllers: [EmployeesController],
  providers: [MicrosoftDirectoryProvisioningService, EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
