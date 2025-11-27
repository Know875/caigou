import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { PrismaModule } from './modules/prisma/prisma.module';
import { validate } from './config/env.validation';
import * as path from 'path';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { StoreModule } from './modules/store/store.module';
import { OrderModule } from './modules/order/order.module';
import { RfqModule } from './modules/rfq/rfq.module';
import { QuoteModule } from './modules/quote/quote.module';
import { AwardModule } from './modules/award/award.module';
import { ShipmentModule } from './modules/shipment/shipment.module';
import { AfterSalesModule } from './modules/after-sales/after-sales.module';
import { ImportModule } from './modules/import/import.module';
import { NotificationModule } from './modules/notification/notification.module';
import { ReportModule } from './modules/report/report.module';
import { OcrModule } from './modules/ocr/ocr.module';
import { AdminModule } from './modules/admin/admin.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { DingTalkModule } from './modules/dingtalk/dingtalk.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { QueueModule } from './queues/queue.module';
import { CronModule } from './cron/cron.module';
import { HealthController } from './modules/health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // 明确指定从 apps/api 目录加载，使用绝对路径避免从根目录加载错误的配置
      envFilePath: [
        path.join(__dirname, '..', '.env.local'),
        path.join(__dirname, '..', '.env'),
        // 也尝试相对路径（如果从 apps/api 目录运行）
        '.env.local',
        '.env',
      ],
      // 确保环境变量被正确加载
      ignoreEnvFile: false,
      // 允许覆盖系统环境变量
      expandVariables: true,
      // 验证环境变量
      validate,
      // 在生产环境必须验证，开发环境允许部分缺失
      validationOptions: {
        allowUnknown: true,
        abortEarly: false,
      },
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UserModule,
    StoreModule,
    OrderModule,
    RfqModule,
    QuoteModule,
    AwardModule,
    ShipmentModule,
    AfterSalesModule,
    ImportModule,
    NotificationModule,
    ReportModule,
    OcrModule,
    AdminModule,
    TrackingModule,
    DingTalkModule,
    InventoryModule,
    QueueModule,
    CronModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule {}

