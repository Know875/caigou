import { Module, Global } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { AuctionQueue } from './auction.queue';
import { OcrQueue } from './ocr.queue';
import { NotificationQueue } from './notification.queue';
import { AfterSalesQueue } from './after-sales.queue';
import { NotificationModule } from '../modules/notification/notification.module';
import { PrismaModule } from '../modules/prisma/prisma.module';
import { OcrModule } from '../modules/ocr/ocr.module';
import { AuditModule } from '../modules/audit/audit.module';

@Global()
@Module({
  imports: [ConfigModule, PrismaModule, NotificationModule, OcrModule, AuditModule],
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        // 使用REDIS_URL或单独配置
        const redisUrl = configService.get<string>('REDIS_URL');
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        
        if (redisUrl) {
          // 解析 URL，提取主机、端口和密码
          // 格式: redis://:password@host:port 或 redis://host:port
          const urlMatch = redisUrl.match(/^redis:\/\/(?::([^@]+)@)?([^:]+):(\d+)$/);
          
          if (urlMatch) {
            // urlMatch[1] = 密码（如果 URL 中有）
            // urlMatch[2] = 主机
            // urlMatch[3] = 端口
            const urlPassword = urlMatch[1];
            const host = urlMatch[2];
            const port = parseInt(urlMatch[3], 10);
            
            // 优先使用环境变量中的密码，如果没有则使用 URL 中的密码
            const finalPassword = redisPassword || urlPassword;
            
            // Redis 5 及以下版本不支持用户名认证，只传递 password
            return new Redis({
              host,
              port,
              password: finalPassword || undefined,
              maxRetriesPerRequest: null, // BullMQ要求
            });
          } else {
            // URL 格式不正确，尝试直接使用（ioredis 会自动解析）
            // 但需要确保不会传递 username
            const redisOptions: any = {
              maxRetriesPerRequest: null, // BullMQ要求
            };
            
            // 如果 URL 中没有密码（不包含 :password@ 或 :@），且环境变量中有密码，则添加密码
            if (redisPassword && !redisUrl.includes('@') && !redisUrl.includes('://:')) {
              redisOptions.password = redisPassword;
            }
            
            // 确保不传递 username（Redis 5 不支持）
            return new Redis(redisUrl, redisOptions);
          }
        }
        
        // 使用单独配置（推荐，兼容 Redis 5）
        return new Redis({
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: configService.get<number>('REDIS_PORT') || 6379,
          password: redisPassword || undefined,
          maxRetriesPerRequest: null, // BullMQ要求
        });
      },
      inject: [ConfigService],
    },
    {
      provide: 'AUCTION_QUEUE',
      useFactory: (redis: Redis) => {
        const queue = new Queue('auction', { connection: redis });
        return queue;
      },
      inject: ['REDIS_CLIENT'],
    },
    {
      provide: 'OCR_QUEUE',
      useFactory: (redis: Redis) => {
        const queue = new Queue('ocr', { connection: redis });
        return queue;
      },
      inject: ['REDIS_CLIENT'],
    },
    {
      provide: 'NOTIFICATION_QUEUE',
      useFactory: (redis: Redis) => {
        const queue = new Queue('notification', { connection: redis });
        return queue;
      },
      inject: ['REDIS_CLIENT'],
    },
    {
      provide: 'AFTER_SALES_QUEUE',
      useFactory: (redis: Redis) => {
        const queue = new Queue('after-sales', { connection: redis });
        return queue;
      },
      inject: ['REDIS_CLIENT'],
    },
    AuctionQueue,
    OcrQueue,
    NotificationQueue,
    AfterSalesQueue,
  ],
  exports: [AuctionQueue, OcrQueue, NotificationQueue, AfterSalesQueue],
})
export class QueueModule {}

