import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { MicrosoftDirectoryProvisioningService } from './microsoft-directory-provisioning.service';
import { SystemService } from './system.service';
import { OrganizationReadinessService } from './organization-readiness.service';

@Module({ controllers: [SystemController], providers: [MicrosoftDirectoryProvisioningService, OrganizationReadinessService, SystemService] })
export class SystemModule {}
