import { Controller, Get, Patch, Param, UseGuards, Request, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('通知')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationController {
  constructor(private notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: '获取通知列表' })
  findAll(@Request() req, @Query('read') read?: string) {
    return this.notificationService.findAll(
      req.user.id,
      read === 'true' ? true : read === 'false' ? false : undefined,
    );
  }

  @Patch(':id/read')
  @ApiOperation({ summary: '标记通知为已读' })
  markAsRead(@Param('id') id: string) {
    return this.notificationService.markAsRead(id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: '标记所有通知为已读' })
  markAllAsRead(@Request() req) {
    return this.notificationService.markAllAsRead(req.user.id);
  }
}

