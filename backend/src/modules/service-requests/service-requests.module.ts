import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { ServiceRequestsController } from './service-requests.controller';
import { ServiceRequestsService } from './service-requests.service';

@Module({ imports: [DocumentsModule], controllers: [ServiceRequestsController], providers: [ServiceRequestsService] })
export class ServiceRequestsModule {}
