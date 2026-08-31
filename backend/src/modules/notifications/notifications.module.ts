import { Module } from '@nestjs/common';
import { EmailDeliveryService } from './email-delivery.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DocumentsModule } from '../documents/documents.module';
@Module({ imports: [DocumentsModule], controllers: [NotificationsController], providers: [EmailDeliveryService, NotificationsService], exports: [EmailDeliveryService, NotificationsService] })
export class NotificationsModule {}
