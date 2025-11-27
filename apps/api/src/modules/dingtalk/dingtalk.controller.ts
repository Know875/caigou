import { Controller, Post, UseGuards, Body, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { DingTalkService } from './dingtalk.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('钉钉')
@Controller('dingtalk')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DingTalkController {
  constructor(private dingTalkService: DingTalkService) {}

  @Post('test')
  @ApiOperation({ summary: '测试钉钉机器人连接' })
  async testConnection(@Request() req) {
    // 检查是否为管理员
    if (req.user.role !== 'ADMIN') {
      return { success: false, message: '仅管理员可操作' };
    }
    return this.dingTalkService.testConnection();
  }

  @Post('test-keyword')
  @ApiOperation({ summary: '测试单个关键词（用于调试）' })
  async testKeyword(
    @Request() req,
    @Body() body: { keyword: string },
  ) {
    // 检查是否为管理员
    if (req.user.role !== 'ADMIN') {
      return { success: false, message: '仅管理员可操作' };
    }
    if (!body.keyword) {
      return { success: false, message: '请提供关键词' };
    }
    // 发送包含单个关键词的测试消息
    const testMessage = `${body.keyword}：这是一条测试消息，用于验证关键词匹配。`;
    return this.dingTalkService.sendText(testMessage);
  }

  @Post('send')
  @ApiOperation({ summary: '发送钉钉消息（测试用）' })
  async sendMessage(
    @Request() req,
    @Body()
    body: {
      type?: string;
      title: string;
      content: string;
      link?: string;
    },
  ) {
    // 检查是否为管理员
    if (req.user.role !== 'ADMIN') {
      return { success: false, message: '仅管理员可操作' };
    }
    return this.dingTalkService.sendNotification({
      type: body.type || 'TEST',
      title: body.title,
      content: body.content,
      link: body.link,
    });
  }

  @Post('check-config')
  @ApiOperation({ summary: '检查钉钉配置和链接生成（诊断用）' })
  async checkConfig(@Request() req) {
    // 检查是否为管理员
    if (req.user.role !== 'ADMIN') {
      return { success: false, message: '仅管理员可操作' };
    }
    return this.dingTalkService.checkConfig();
  }
}

