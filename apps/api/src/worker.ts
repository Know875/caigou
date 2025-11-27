import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Worker } from 'bullmq';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { AuctionQueue, auctionProcessors } from './queues/auction.queue';
import { OcrQueue, ocrProcessors } from './queues/ocr.queue';
import { NotificationQueue, notificationProcessors } from './queues/notification.queue';
import { AfterSalesQueue, afterSalesProcessors } from './queues/after-sales.queue';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const configService = app.get(ConfigService);

  // 浣跨敤REDIS_URL鎴栧崟鐙厤缃?
  const redisUrl = configService.get<string>('REDIS_URL');
  const redisPassword = configService.get<string>('REDIS_PASSWORD');
  
  const redis = redisUrl 
    ? (() => {
        // 瑙ｆ瀽 URL锛屾彁鍙栦富鏈恒€佺鍙ｅ拰瀵嗙爜
        // 鏍煎紡: redis://:password@host:port 鎴?redis://host:port
        const urlMatch = redisUrl.match(/^redis:\/\/(?::([^@]+)@)?([^:]+):(\d+)$/);
        
        if (urlMatch) {
          // urlMatch[1] = 瀵嗙爜锛堝鏋?URL 涓湁锛?
          // urlMatch[2] = 涓绘満
          // urlMatch[3] = 绔彛
          const urlPassword = urlMatch[1];
          const host = urlMatch[2];
          const port = parseInt(urlMatch[3], 10);
          
          // 浼樺厛浣跨敤鐜鍙橀噺涓殑瀵嗙爜锛屽鏋滄病鏈夊垯浣跨敤 URL 涓殑瀵嗙爜
          const finalPassword = redisPassword || urlPassword;
          
          // Redis 5 鍙婁互涓嬬増鏈笉鏀寔鐢ㄦ埛鍚嶈璇侊紝鍙紶閫?password
          return new Redis({
            host,
            port,
            password: finalPassword || undefined,
            maxRetriesPerRequest: null, // BullMQ瑕佹眰
          });
        } else {
          // URL 鏍煎紡涓嶆纭紝灏濊瘯鐩存帴浣跨敤锛坕oredis 浼氳嚜鍔ㄨВ鏋愶級
          // 浣嗛渶瑕佺‘淇濅笉浼氫紶閫?username
          const redisOptions: any = {
            maxRetriesPerRequest: null, // BullMQ瑕佹眰
          };
          
          // 濡傛灉 URL 涓病鏈夊瘑鐮侊紙涓嶅寘鍚?:password@ 鎴?:@锛夛紝涓旂幆澧冨彉閲忎腑鏈夊瘑鐮侊紝鍒欐坊鍔犲瘑鐮?
          if (redisPassword && !redisUrl.includes('@') && !redisUrl.includes('://:')) {
            redisOptions.password = redisPassword;
          }
          
          // 纭繚涓嶄紶閫?username锛圧edis 5 涓嶆敮鎸侊級
          return new Redis(redisUrl, redisOptions);
        }
      })()
    : new Redis({
        host: configService.get<string>('REDIS_HOST') || 'localhost',
        port: configService.get<number>('REDIS_PORT') || 6379,
        password: redisPassword || undefined,
        maxRetriesPerRequest: null, // BullMQ瑕佹眰
      });

  const auctionQueue = app.get(AuctionQueue);
  const ocrQueue = app.get(OcrQueue);
  const notificationQueue = app.get(NotificationQueue);
  const afterSalesQueue = app.get(AfterSalesQueue);

  // 鍚姩 Worker锛堥厤缃苟鍙戞暟浠ユ彁鍗囧鐞嗚兘鍔涳級
  const auctionWorker = new Worker('auction', async (job) => {
    const processor = auctionProcessors[job.name as keyof typeof auctionProcessors];
    if (processor) {
      await processor(job, auctionQueue);
    }
  }, { 
    connection: redis,
    concurrency: 5, // 姣忎釜 Worker 鍚屾椂澶勭悊 5 涓换鍔?
  });

  const ocrWorker = new Worker('ocr', async (job) => {
    const processor = ocrProcessors[job.name as keyof typeof ocrProcessors];
    if (processor) {
      await processor(job, ocrQueue);
    }
  }, { 
    connection: redis,
    concurrency: 3, // OCR 澶勭悊杈冩參锛屽苟鍙戞暟杈冧綆
  });

  const notificationWorker = new Worker('notification', async (job) => {
    const processor = notificationProcessors[job.name as keyof typeof notificationProcessors];
    if (processor) {
      await processor(job, notificationQueue);
    }
  }, { 
    connection: redis,
    concurrency: 10, // 閫氱煡鍙戦€佽緝蹇紝鍙互鏇撮珮骞跺彂
  });

  const afterSalesWorker = new Worker('after-sales', async (job) => {
    const processor = afterSalesProcessors[job.name as keyof typeof afterSalesProcessors];
    if (processor) {
      await processor(job, afterSalesQueue);
    }
  }, { 
    connection: redis,
    concurrency: 5, // 鍞悗澶勭悊涓瓑骞跺彂
  });

  // console.log('馃殌 Queue Workers started');

  // 浼橀泤鍏抽棴
  process.on('SIGTERM', async () => {
    await auctionWorker.close();
    await ocrWorker.close();
    await notificationWorker.close();
    await afterSalesWorker.close();
    await app.close();
  });
}

bootstrap();

