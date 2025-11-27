import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../modules/prisma/prisma.service';
import { AuctionQueue } from '../queues/auction.queue';
import { AfterSalesQueue } from '../queues/after-sales.queue';

@Injectable()
export class CronService {
  constructor(
    private prisma: PrismaService,
    private auctionQueue: AuctionQueue,
    private afterSalesQueue: AfterSalesQueue,
  ) {}

  /**
   * 每天 02:15（上海时间）提醒未授标 RFQ
   */
  @Cron('15 2 * * *', {
    timeZone: 'Asia/Shanghai',
  })
  async remindUnawardedRfqs() {
    // console.log('[Cron] 开始执行未授标提醒任务...');

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(2, 0, 0, 0);

    const today = new Date();
    today.setHours(2, 0, 0, 0);

    // 查找在昨日 02:00 至今日 02:00 之间关闭、且未授标的 RFQ
    const rfqs = await this.prisma.rfq.findMany({
      where: {
        status: 'CLOSED',
        closeTime: {
          gte: yesterday,
          lt: today,
        },
        awards: {
          none: {},
        },
      },
      include: {
        quotes: {
          where: { status: 'SUBMITTED' },
        },
      },
    });

    for (const rfq of rfqs) {
      if (rfq.quotes.length > 0) {
        // 有报价但未授标，提醒采购员
        await this.auctionQueue.addRemindJob(rfq.id, [rfq.buyerId]);
      }
    }

    // console.log(`[Cron] 未授标提醒完成，共处理 ${rfqs.length} 条 RFQ`);
  }

  /**
   * 每分钟检查并关闭已过期的询价单
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async checkAndCloseExpiredRfqs() {
    const now = new Date();
    
    // 查找所有已发布但已过期的询价单
    const expiredRfqs = await this.prisma.rfq.findMany({
      where: {
        status: 'PUBLISHED',
        deadline: {
          lte: now,
        },
      },
      select: {
        id: true,
        rfqNo: true,
        deadline: true,
      },
    });

    if (expiredRfqs.length > 0) {
      console.log(`[Cron] 发现 ${expiredRfqs.length} 个已过期的询价单，开始关闭...`);
      
      for (const rfq of expiredRfqs) {
        try {
          // 直接调用关闭处理逻辑
          await this.auctionQueue.processClose({ data: { rfqId: rfq.id } });
          console.log(`[Cron] 已关闭过期询价单: ${rfq.rfqNo}`);
        } catch (error) {
          console.error(`[Cron] 关闭询价单失败: ${rfq.rfqNo}`, error);
        }
      }
    }
  }

  /**
   * 每小时检查售后工单 SLA
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkAfterSalesSLA() {
    // console.log('[Cron] 开始检查售后工单 SLA...');

    const cases = await this.prisma.afterSalesCase.findMany({
      where: {
        status: {
          notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'],
        },
        slaDeadline: {
          lte: new Date(),
        },
      },
      include: {
        handler: true,
      },
    });

    for (const case_ of cases) {
      if (case_.handlerId) {
        await this.afterSalesQueue.addReminderJob(case_.id, case_.handlerId);
      }
    }

    // ✅ 这里原来那行字符串少了一个反引号，现在也一起修好了
    // console.log(
    //   `[Cron] SLA 检查完成，共发现 ${cases.length} 条超时工单`,
    // );
  }
}
