import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import Redis from 'ioredis';

@Module({
  imports: [
    PrismaModule,
    StorageModule,
    CacheModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        
        let redisClient: Redis;
        
        if (redisUrl) {
          // 解析 Redis URL
          const urlMatch = redisUrl.match(/^redis:\/\/(?::([^@]+)@)?([^:]+):(\d+)$/);
          if (urlMatch) {
            const urlPassword = urlMatch[1];
            const host = urlMatch[2];
            const port = parseInt(urlMatch[3], 10);
            const finalPassword = redisPassword || urlPassword;
            
            redisClient = new Redis({
              host,
              port,
              password: finalPassword || undefined,
            });
          } else {
            redisClient = new Redis(redisUrl);
          }
        } else {
          // 使用单独配置
          redisClient = new Redis({
            host: configService.get<string>('REDIS_HOST') || 'localhost',
            port: configService.get<number>('REDIS_PORT') || 6379,
            password: redisPassword || undefined,
          });
        }
        
        // 使用内存缓存作为后备方案（如果Redis不可用）
        return {
          store: 'memory',
          ttl: 300, // 默认5分钟TTL
          max: 100, // 最大缓存项数
          // 注意：这里使用内存缓存，Redis缓存通过直接使用ioredis客户端实现
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [ReportController],
  providers: [
    ReportService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const redisUrl = configService.get<string>('REDIS_URL');
        const redisPassword = configService.get<string>('REDIS_PASSWORD');
        
        if (redisUrl) {
          const urlMatch = redisUrl.match(/^redis:\/\/(?::([^@]+)@)?([^:]+):(\d+)$/);
          if (urlMatch) {
            const urlPassword = urlMatch[1];
            const host = urlMatch[2];
            const port = parseInt(urlMatch[3], 10);
            const finalPassword = redisPassword || urlPassword;
            
            return new Redis({
              host,
              port,
              password: finalPassword || undefined,
            });
          }
          return new Redis(redisUrl);
        }
        
        return new Redis({
          host: configService.get<string>('REDIS_HOST') || 'localhost',
          port: configService.get<number>('REDIS_PORT') || 6379,
          password: redisPassword || undefined,
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [ReportService],
})
export class ReportModule {}

