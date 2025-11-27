import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { NotificationService } from '../modules/notification/notification.service';

@Injectable()
export class NotificationQueue {
  constructor(
    @Inject('NOTIFICATION_QUEUE') private notificationQueue: Queue,
    private notificationService: NotificationService,
  ) {}

  /**
   * 获取批次日期（用于幂等键）
   */
  private getBatchDate(date?: Date): string {
    const d = date || new Date();
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * 添加通知任务
   */
  async addNotificationJob(data: {
    userId: string;
    type: string;
    title: string;
    content: string;
    link?: string;
  }) {
    const batchDate = this.getBatchDate();
    const jobId = `notification:${data.userId}:${batchDate}`;
    await this.notificationQueue.add(
      'send',
      data,
      {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000,
        },
      },
    );
  }

  /**
   * 处理通知发送
   */
  async processSend(job: any) {
    const { userId, type, title, content, link } = job.data;
    
    await this.notificationService.create({
      userId,
      type,
      title,
      content,
      link,
    });

    // 这里可以扩展：发送邮件、Webhook 等
    // await this.sendEmail(userId, title, content);
    // await this.sendWebhook(webhookUrl, { userId, type, title, content });
  }
}

// 导出 Worker 处理器（用于 worker.ts）
export const notificationProcessors = {
  send: async (job: any, notificationQueue: NotificationQueue) => {
    await notificationQueue.processSend(job);
  },
};

