import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DingTalkService } from './dingtalk.service';
import { DingTalkController } from './dingtalk.controller';

@Module({
  imports: [ConfigModule],
  controllers: [DingTalkController],
  providers: [DingTalkService],
  exports: [DingTalkService],
})
export class DingTalkModule {}

