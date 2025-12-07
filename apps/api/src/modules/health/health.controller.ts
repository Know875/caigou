import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { PrismaService } from '../prisma/prisma.service';
import { Injectable } from '@nestjs/common';

@Injectable()
@ApiTags('健康检查')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: '健康检查' })
  async check() {
    const startTime = Date.now();
    const checks: Record<string, any> = {
      timestamp: new Date().toISOString(),
    };

    // 检查数据库连接
    try {
      const dbStartTime = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      const dbResponseTime = Date.now() - dbStartTime;
      
      // 检查数据库连接数（如果可能）
      let dbConnections = null;
      try {
        const result = await this.prisma.$queryRaw<Array<{ Threads_connected: number }>>`
          SHOW STATUS LIKE 'Threads_connected'
        `;
        if (result && result.length > 0) {
          dbConnections = result[0].Threads_connected;
        }
      } catch (e) {
        // 忽略权限错误
      }

      checks.database = {
        status: 'connected',
        responseTime: `${dbResponseTime}ms`,
        connections: dbConnections,
      };
    } catch (error) {
      checks.database = {
        status: 'disconnected',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    // 检查内存使用
    const memUsage = process.memoryUsage();
    checks.memory = {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
    };

    // 检查运行时间
    checks.uptime = {
      seconds: Math.floor(process.uptime()),
      formatted: `${Math.floor(process.uptime() / 60)}分${Math.floor(process.uptime() % 60)}秒`,
    };

    // 总体状态
    const totalResponseTime = Date.now() - startTime;
    const overallStatus = checks.database?.status === 'connected' ? 'ok' : 'error';

    return {
      status: overallStatus,
      responseTime: `${totalResponseTime}ms`,
      ...checks,
    };
  }
}

