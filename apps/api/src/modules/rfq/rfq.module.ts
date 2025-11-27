import { Module } from '@nestjs/common';
import { RfqService } from './rfq.service';
import { RfqController } from './rfq.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationModule } from '../notification/notification.module';
import { DingTalkModule } from '../dingtalk/dingtalk.module';
import { QueueModule } from '../../queues/queue.module';

@Module({
  imports: [PrismaModule, AuditModule, NotificationModule, DingTalkModule, QueueModule],
  controllers: [RfqController],
  providers: [RfqService],
  exports: [RfqService],
})
export class RfqModule {}

