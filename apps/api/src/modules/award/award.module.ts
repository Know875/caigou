import { Module } from '@nestjs/common';
import { AwardService } from './award.service';
import { AwardController } from './award.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuditModule } from '../audit/audit.module';
import { QueueModule } from '../../queues/queue.module';
import { NotificationModule } from '../notification/notification.module';

@Module({
  imports: [PrismaModule, StorageModule, AuditModule, QueueModule, NotificationModule],
  controllers: [AwardController],
  providers: [AwardService],
  exports: [AwardService],
})
export class AwardModule {}

