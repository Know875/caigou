import { Injectable, OnModuleInit, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private configService?: ConfigService;

  constructor(@Optional() configService?: ConfigService) {
    // 先保存 configService，但不能使用 this.configService（因为还没调用 super()）
    // 强制从 apps/api/.env.local 读取 DATABASE_URL，忽略其他来源
    let databaseUrl: string | undefined;
    
    // 尝试从 apps/api/.env.local 直接读取
    const envLocalPath = path.join(__dirname, '..', '..', '.env.local');
    const envPath = path.join(__dirname, '..', '..', '.env');
    
    const envFiles = [envLocalPath, envPath];
    for (const envFile of envFiles) {
      try {
        if (fs.existsSync(envFile)) {
          const content = fs.readFileSync(envFile, 'utf-8');
          const match = content.match(/^DATABASE_URL\s*=\s*(.+)$/m);
          if (match) {
            let url = match[1].trim();
            // 去掉首尾的引号（单引号或双引号）
            url = url.replace(/^["']|["']$/g, '');
            if (url.startsWith('mysql://')) {
              databaseUrl = url;
              console.log(`[PrismaService] Loaded DATABASE_URL from ${envFile}`);
              break;
            }
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }
    
    // 如果从文件读取失败，尝试 ConfigService 和 process.env
    // 注意：这里不能使用 this.configService，因为还没调用 super()
    if (!databaseUrl) {
      const configServiceUrl = configService?.get<string>('DATABASE_URL');
      const processEnvUrl = process.env.DATABASE_URL;
      
      console.log('[PrismaService] Debug DATABASE_URL sources:');
      console.log('  ConfigService available:', !!configService);
      console.log('  ConfigService.get("DATABASE_URL"):', configServiceUrl || 'undefined');
      console.log('  process.env.DATABASE_URL:', processEnvUrl || 'undefined');
      console.log('  process.cwd():', process.cwd());
      
      // 只使用 MySQL URL
      databaseUrl = configServiceUrl || processEnvUrl;
      if (databaseUrl && databaseUrl.startsWith('mysql://')) {
        console.log('[PrismaService] Using MySQL URL from ConfigService/process.env');
      } else if (databaseUrl) {
        console.warn('[PrismaService] Ignoring non-MySQL URL from ConfigService/process.env:', databaseUrl.substring(0, 50));
        databaseUrl = undefined;
      }
    }
    
    // 验证 URL 格式
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is not set in environment variables');
    }
    
    if (!databaseUrl.startsWith('mysql://')) {
      console.error('[PrismaService] Invalid DATABASE_URL format:', databaseUrl);
      console.error('[PrismaService] Full URL:', databaseUrl);
      throw new Error(`DATABASE_URL must start with 'mysql://', got: ${databaseUrl.substring(0, 50)}...`);
    }
    
    // 现在可以调用 super() 了
    super({
      datasources: {
        db: {
          url: databaseUrl,
        },
      },
      // 配置连接池参数，防止长时间不活跃后连接超时
      log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
    
    // super() 调用后，可以安全地保存 configService
    this.configService = configService;
  }

  async onModuleInit() {
    await this.$connect();
    // 定期执行轻量级查询保持连接活跃（每5分钟）
    setInterval(async () => {
      try {
        await this.$queryRaw`SELECT 1`;
      } catch (error) {
        console.error('[PrismaService] 连接保活查询失败:', error);
      }
    }, 5 * 60 * 1000); // 5分钟
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

