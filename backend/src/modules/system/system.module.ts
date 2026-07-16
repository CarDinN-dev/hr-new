import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { MicrosoftDirectoryProvisioningService } from './microsoft-directory-provisioning.service';
import { SystemService } from './system.service';

@Module({ controllers: [SystemController], providers: [MicrosoftDirectoryProvisioningService, SystemService] })
export class SystemModule {}
