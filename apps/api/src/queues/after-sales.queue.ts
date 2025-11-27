import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../modules/prisma/prisma.service';
import { NotificationService } from '../modules/notification/notification.service';

@Injectable()
export class AfterSalesQueue {
  constructor(
    @Inject('AFTER_SALES_QUEUE') private afterSalesQueue: Queue,
    private prisma: PrismaService,
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
   * 添加售后提醒任务
   */
  async addReminderJob(caseId: string, handlerId: string) {
    const batchDate = this.getBatchDate();
    const jobId = `aftersales-reminder:${caseId}:${batchDate}`;
    await this.afterSalesQueue.add(
      'remind',
      { caseId, handlerId },
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
   * 处理售后提醒
   */
  async processRemind(job: any) {
    const { caseId, handlerId } = job.data;
    
    const case_ = await this.prisma.afterSalesCase.findUnique({
      where: { id: caseId },
    });

    if (!case_ || case_.status === 'RESOLVED' || case_.status === 'CLOSED') {
      return;
    }

    // 检查是否超过 SLA
    if (case_.slaDeadline && new Date() > case_.slaDeadline) {
      await this.notificationService.create({
        userId: handlerId,
        type: 'AFTERSALES_ALERT',
        title: '售后工单超时',
        content: `售后工单 ${case_.caseNo} 已超过 SLA 截止时间，请及时处理`,
        link: `/after-sales/${caseId}`,
      });
    }
  }
}

// 导出 Worker 处理器（用于 worker.ts）
export const afterSalesProcessors = {
  remind: async (job: any, afterSalesQueue: AfterSalesQueue) => {
    await afterSalesQueue.processRemind(job);
  },
};

