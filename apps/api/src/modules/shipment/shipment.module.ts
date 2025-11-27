import { Module } from '@nestjs/common';
import { ShipmentService } from './shipment.service';
import { ShipmentController } from './shipment.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { OcrModule } from '../ocr/ocr.module';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../../queues/queue.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, StorageModule, OcrModule, AuditModule, QueueModule, NotificationModule],
  controllers: [ShipmentController],
  providers: [ShipmentService],
  exports: [ShipmentService],
})
export class ShipmentModule {}

