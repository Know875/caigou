import { Module } from '@nestjs/common';
import { AfterSalesService } from './after-sales.service';
import { AfterSalesController } from './after-sales.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { StorageModule } from '../storage/storage.module';
import { QueueModule } from '../../queues/queue.module';
import { NotificationModule } from '../notification/notification.module';
import { ShipmentModule } from '../shipment/shipment.module';

@Module({
  imports: [
    PrismaModule,
    AuditModule,
    StorageModule,
    QueueModule,
    NotificationModule,
    ShipmentModule,
  ],
  controllers: [AfterSalesController],
  providers: [AfterSalesService],
  exports: [AfterSalesService],
})
export class AfterSalesModule {}

