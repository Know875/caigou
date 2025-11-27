import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DingTalkService } from '../dingtalk/dingtalk.service';

@Injectable()
export class NotificationService {
  constructor(
    private prisma: PrismaService,
    @Optional() private dingTalkService?: DingTalkService,
  ) {}

  async create(data: {
    userId: string;
    type: string;
    title: string;
    content: string;
    link?: string;
    userName?: string;
    sendDingTalk?: boolean; // 鏄惁鍙戦€侀拤閽夐€氱煡锛岄粯璁や负true
  }) {
    // 鍒涘缓鏁版嵁搴撻€氱煡璁板綍
    // 截断过长的内容，避免超过数据库字段限制（限制为 5000 字符）
    const MAX_CONTENT_LENGTH = 5000;
    let truncatedContent = data.content;
    if (truncatedContent.length > MAX_CONTENT_LENGTH) {
      truncatedContent = truncatedContent.substring(0, MAX_CONTENT_LENGTH - 3) + '...';
    }

    // 截断过长的标题，避免超过数据库字段限制（限制为 255 字符）
    const MAX_TITLE_LENGTH = 255;
    let truncatedTitle = data.title;
    if (truncatedTitle.length > MAX_TITLE_LENGTH) {
      truncatedTitle = truncatedTitle.substring(0, MAX_TITLE_LENGTH - 3) + '...';
    }

    const notification = await this.prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type as any,
        title: truncatedTitle,
        content: truncatedContent,
        link: data.link,
      },
    });

    // 鍙戦€侀拤閽夐€氱煡锛堝紓姝ワ紝涓嶉樆濉烇級
    // 濡傛灉 sendDingTalk 鏄庣‘涓?false锛屽垯璺宠繃閽夐拤閫氱煡锛堢敤浜庢壒閲忛€氱煡鍦烘櫙锛岄伩鍏嶉噸澶嶅彂閫侊級
    // 濡傛灉 sendDingTalk 涓?undefined 鎴?true锛屽垯鍙戦€侀拤閽夐€氱煡锛堜繚鎸佸悜鍚庡吋瀹癸級
    
    // 瀵逛簬 RFQ_PUBLISHED 鍜?QUOTE_AWARDED 绫诲瀷锛屽鏋?sendDingTalk 涓?false锛屽己鍒惰烦杩囬拤閽夐€氱煡
    // 鍥犱负杩欎簺绫诲瀷浼氭湁涓撻棬鐨勬眹鎬绘秷鎭彂閫侊紝閬垮厤閲嶅鍙戦€?
    const isBatchNotificationType = data.type === 'RFQ_PUBLISHED' || data.type === 'QUOTE_AWARDED';
    
    // 濡傛灉 sendDingTalk 鏄庣‘涓?false锛屽垯璺宠繃锛堟棤璁轰粈涔堢被鍨嬶級
    // 瀵逛簬鎵归噺閫氱煡绫诲瀷锛屽鏋?sendDingTalk 涓?false锛屼篃璺宠繃
    const shouldSendDingTalk = data.sendDingTalk !== false;
    
    if (this.dingTalkService && shouldSendDingTalk) {
      // console.log(`[NotificationService] 鉁?鍙戦€侀拤閽夐€氱煡: userId=${data.userId}, userName=${data.userName}, sendDingTalk=${data.sendDingTalk}, type=${data.type}`);
      this.dingTalkService
        .sendNotification({
          type: data.type,
          title: data.title,
          content: data.content,
          link: data.link,
          userId: data.userId,
          userName: data.userName,
        })
        .catch((error) => {
          console.error('[NotificationService] 閽夐拤閫氱煡鍙戦€佸け璐?', error);
        });
    } else {
      // console.log(`[NotificationService] 鈴笍 璺宠繃閽夐拤閫氱煡: userId=${data.userId}, userName=${data.userName}, sendDingTalk=${data.sendDingTalk}, type=${data.type}, isBatchType=${isBatchNotificationType}, shouldSend=${shouldSendDingTalk}`);
    }

    return notification;
  }

  async findAll(userId: string, read?: boolean) {
    return this.prisma.notification.findMany({
      where: {
        userId,
        read: read !== undefined ? read : undefined,
      },
      orderBy: {
        createdAt: 'desc',
      },
      take: 50,
    });
  }

  async markAsRead(id: string) {
    return this.prisma.notification.update({
      where: { id },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
  }
}

