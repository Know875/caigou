import { Module } from '@nestjs/common';
import { CronService } from './cron.service';
import { QueueModule } from '../queues/queue.module';
import { PrismaModule } from '../modules/prisma/prisma.module';

@Module({
  imports: [QueueModule, PrismaModule],
  providers: [CronService],
})
export class CronModule {}

