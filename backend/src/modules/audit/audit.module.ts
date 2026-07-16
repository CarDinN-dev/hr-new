import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { DocumentStorageService } from '../documents/document-storage.service';

@Global()
@Module({ controllers: [AuditController], providers: [AuditService, DocumentStorageService], exports: [AuditService] })
export class AuditModule {}
