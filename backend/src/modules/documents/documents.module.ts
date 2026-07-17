import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentMalwareScannerService } from './document-malware-scanner.service';
import { DocumentStorageService } from './document-storage.service';

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentStorageService, DocumentMalwareScannerService],
  exports: [DocumentStorageService],
})
export class DocumentsModule {}
