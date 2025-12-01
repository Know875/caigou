import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../modules/prisma/prisma.service';
import { NotificationService } from '../modules/notification/notification.service';
import { AuditService } from '../modules/audit/audit.service';

@Injectable()
export class AuctionQueue {
  constructor(
    @Inject('AUCTION_QUEUE') private auctionQueue: Queue,
    private prisma: PrismaService,
    private notificationService: NotificationService,
    private auditService: AuditService,
  ) {}

  /**
   * 添加截标任务
   */
  async addCloseJob(rfqId: string, deadline: Date) {
    const jobId = 'auction-close:' + rfqId + ':' + this.getBatchDate(deadline);
    const delay = deadline.getTime() - Date.now();
    
    // 如果截止时间已经过了，立即执行关闭操作
    if (delay <= 0) {
      // 立即处理关闭任务
      await this.processClose({ data: { rfqId } });
      return;
    }
    
    await this.auctionQueue.add(
      'close',
      { rfqId },
      {
        jobId,
        delay,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60_000, // 1 minute
        },
      },
    );
  }

  /**
   * 添加评标任务
   */
  async addEvaluateJob(rfqId: string) {
    const jobId = 'auction-evaluate:' + rfqId + ':' + this.getBatchDate();
    await this.auctionQueue.add(
      'evaluate',
      { rfqId },
      {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60_000,
        },
      },
    );
  }

  /**
   * 添加提醒任务
   */
  async addRemindJob(rfqId: string, supplierIds: string[]) {
    const batchDate = this.getBatchDate();
    for (const supplierId of supplierIds) {
      const jobId = 'auction-remind:' + rfqId + ':' + supplierId + ':' + batchDate;
      await this.auctionQueue.add(
        'remind',
        { rfqId, supplierId },
        {
          jobId,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 60_000,
          },
        },
      );
    }
  }

  /**
   * 处理截标
   */
  async processClose(job: any) {
    const { rfqId } = job.data;

    // 先检查询价单状态，避免重复关闭
    const rfq = await this.prisma.rfq.findUnique({
      where: { id: rfqId },
      select: { id: true, status: true, deadline: true, rfqNo: true },
    });

    if (!rfq) {
      console.warn(`[AuctionQueue] RFQ not found: ${rfqId}`);
      return;
    }

    // 如果已经关闭，不需要重复处理
    if (rfq.status === 'CLOSED' || rfq.status === 'AWARDED') {
      console.log(`[AuctionQueue] RFQ ${rfqId} already closed, status: ${rfq.status}`);
      return;
    }

    // 检查截止时间是否真的到了
    if (rfq.deadline && new Date(rfq.deadline) > new Date()) {
      console.log(`[AuctionQueue] RFQ ${rfqId} deadline not reached yet, skipping`);
      return;
    }

    // 关闭 RFQ
    await this.prisma.rfq.update({
      where: { id: rfqId },
      data: {
        status: 'CLOSED',
        closeTime: new Date(),
      },
    });

    // 立即触发评标（直接调用，不通过队列，确保立即执行）
    console.log(`[AuctionQueue] 询价单 ${rfq.rfqNo || rfqId} 已关闭，开始自动评标...`);
    try {
      // 直接调用评标处理，确保立即执行
      await this.processEvaluate({ data: { rfqId } });
      console.log(`[AuctionQueue] 询价单 ${rfq.rfqNo || rfqId} 自动评标完成`);
    } catch (error) {
      console.error(`[AuctionQueue] 自动评标失败，询价单 ${rfq.rfqNo || rfqId}:`, error);
      // 如果直接调用失败，尝试通过队列重试
      console.log(`[AuctionQueue] 尝试通过队列重试评标...`);
      await this.addEvaluateJob(rfqId);
    }
  }

  /**
   * 处理评标（按商品级别自动选商）
   */
  async processEvaluate(job: any) {
    const { rfqId } = job.data;

    if (!rfqId) {
      console.error('[AuctionQueue] RFQ ID is missing in job data');
      return;
    }

    console.log(`[AuctionQueue] 开始处理自动评标，RFQ ID: ${rfqId}`);

    try {
      const rfq = await this.prisma.rfq.findUnique({
        where: { id: rfqId },
        include: {
          items: true,
          quotes: {
            where: { status: 'SUBMITTED' },
            include: {
              items: {
                include: {
                  rfqItem: true,
                },
              },
              supplier: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                },
              },
            },
            orderBy: {
              submittedAt: 'asc', // 按提交时间排序，用于一口价逻辑（先提交者中标）
            },
          },
          buyer: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
      });

      if (!rfq) {
        console.error('[AuctionQueue] RFQ not found: ' + rfqId);
        return;
      }

      // 确保 rfq 对象和其属性存在
      if (!rfq.items || !Array.isArray(rfq.items)) {
        console.error('[AuctionQueue] RFQ items not found or invalid: ' + rfqId);
        return;
      }

      if (!rfq.quotes || !Array.isArray(rfq.quotes)) {
        console.error('[AuctionQueue] RFQ quotes not found or invalid: ' + rfqId);
        return;
      }

      // 过滤掉 rfqItem 为 null 的 quote.items（可能关联的 RfqItem 已被删除）
      rfq.quotes = rfq.quotes.map(quote => ({
        ...quote,
        items: quote.items.filter((item: any) => item.rfqItem !== null && item.rfqItem !== undefined),
      }));

      if (rfq.quotes.length === 0) {
      // 没有任何报价：通知采购员所有商品都需要从电商平台采购
      const allItemNames = rfq.items
        .map((item) => item.productName + ' x ' + (item.quantity ?? 1))
        .join('、');

      await this.notificationService.create({
        userId: rfq.buyerId,
        type: 'RFQ_NO_QUOTES',
        title: '询价单无任何报价',
        content:
          '询价单 ' +
          rfq.rfqNo +
          ' 已截标，但未收到任何供应商报价，共 ' +
          rfq.items.length +
          ' 个商品需要从电商平台采购：' +
          allItemNames,
        link: '/purchase',
      });
      return;
    }

    // 按商品维度选择最低价
    const itemAwards: Array<{
      rfqItemId: string;
      quoteItemId: string;
      quoteId: string;
      supplierId: string;
      price: number;
    }> = [];

    const unquotedItems: string[] = [];

    // 对每个商品选择"中标报价"
    for (const rfqItem of rfq.items) {
      // 如果商品已经中标、取消或缺货，跳过
      if (rfqItem.itemStatus === 'AWARDED' || rfqItem.itemStatus === 'CANCELLED' || rfqItem.itemStatus === 'OUT_OF_STOCK') {
        console.log(`[AuctionQueue] 商品 ${rfqItem.productName} (${rfqItem.id}) 已中标/取消/缺货，跳过评标`);
        continue;
      }

      // 找到所有报了该商品价的 quoteItem
      const quoteItemsForThisProduct = rfq.quotes
        .flatMap((quote) =>
          quote.items
            .filter((item: any) => {
              // 过滤掉 rfqItem 为 null 或 undefined 的 quoteItem（可能关联的 RfqItem 已被删除）
              if (!item.rfqItem) {
                return false;
              }
              return item.rfqItemId === rfqItem.id;
            })
            .map((item: any) => ({
              ...item,
              quoteId: quote.id,
              supplierId: quote.supplierId,
              supplier: quote.supplier,
              quote: {
                // 确保包含submittedAt，用于一口价逻辑（先提交者中标）
                id: quote.id,
                submittedAt: quote.submittedAt,
                supplierId: quote.supplierId,
              },
            })),
        )
        .filter((item: any) => Number(item.price) > 0);

      if (quoteItemsForThisProduct.length === 0) {
        // 没人报这个商品
        unquotedItems.push(rfqItem.id);
        continue;
      }

      let bestQuoteItem: any;

      // 首先检查是否有 instantPrice（一口价），优先选择满足一口价条件的报价
      const instantPrice = rfqItem.instantPrice
        ? parseFloat(rfqItem.instantPrice.toString())
        : null;

      if (instantPrice) {
        // ⚠️ 重要：一口价逻辑是"先提交者中标"，按提交时间排序，而不是价格
        // 优先选择满足一口价条件的报价（价格 <= instantPrice），按提交时间排序
        const instantPriceQuotes = quoteItemsForThisProduct
          .filter((item: any) => parseFloat(item.price) <= instantPrice)
          .sort((a: any, b: any) => {
            // 按报价提交时间排序（最早提交的在前）
            const timeA = a.quote?.submittedAt || a.createdAt || new Date(0);
            const timeB = b.quote?.submittedAt || b.createdAt || new Date(0);
            return new Date(timeA).getTime() - new Date(timeB).getTime();
          });

        if (instantPriceQuotes.length > 0) {
          // 有满足一口价的报价，选择最早提交的（先提交者中标）
          bestQuoteItem = instantPriceQuotes[0];
          const submittedAt = bestQuoteItem.quote?.submittedAt || bestQuoteItem.createdAt || '未知';
          console.log(`[AuctionQueue] 商品 ${rfqItem.productName} 有满足一口价(¥${instantPrice})的报价，选择最早提交的: ¥${bestQuoteItem.price}，提交时间: ${submittedAt}`);
        } else {
          // 没有满足一口价的报价，继续按其他逻辑处理
          console.log(`[AuctionQueue] 商品 ${rfqItem.productName} 没有满足一口价(¥${instantPrice})的报价，继续按其他逻辑处理`);
        }
      }

      // 如果没有找到满足一口价的报价，按询价单类型处理
      if (!bestQuoteItem) {
        if (rfq.type === 'FIXED_PRICE') {
          // 一口价询价单：选择价格 <= maxPrice 且最低的那条
          const fixedPrice = rfqItem.maxPrice
            ? parseFloat(rfqItem.maxPrice.toString())
            : null;

          if (fixedPrice) {
            const validQuotes = quoteItemsForThisProduct
              .filter((item: any) => parseFloat(item.price) <= fixedPrice)
              .sort((a: any, b: any) => {
                const priceA = parseFloat(a.price) || 0;
                const priceB = parseFloat(b.price) || 0;
                return priceA - priceB;
              });

            if (validQuotes.length > 0) {
              bestQuoteItem = validQuotes[0];
            } else {
              // 没有满足最高限价条件的报价
              unquotedItems.push(rfqItem.id);
              continue;
            }
          } else {
            // 没有设置 maxPrice，当普通竞价处理
            const sortedByPrice = [...quoteItemsForThisProduct].sort((a, b) => {
              const priceA = parseFloat(a.price) || 0;
              const priceB = parseFloat(b.price) || 0;
              return priceA - priceB;
            });
            bestQuoteItem = sortedByPrice[0];
          }
        } else {
          // AUCTION / NORMAL：使用最低价
          const sortedByPrice = [...quoteItemsForThisProduct].sort((a, b) => {
            const priceA = parseFloat(a.price) || 0;
            const priceB = parseFloat(b.price) || 0;
            return priceA - priceB;
          });

          const top3 = sortedByPrice.slice(0, 3);
          if (top3.length === 0) {
            unquotedItems.push(rfqItem.id);
            continue;
          }
          bestQuoteItem = top3[0];
        }
      }

      if (bestQuoteItem) {
        itemAwards.push({
          rfqItemId: rfqItem.id,
          quoteItemId: bestQuoteItem.id,
          quoteId: bestQuoteItem.quoteId,
          supplierId: bestQuoteItem.supplierId,
          price: Number(bestQuoteItem.price),
        });
      }
    }

    // 为每个中标商品，更新 RfqItem 状态
    const supplierAwardMap = new Map<
      string,
      {
        supplierId: string;
        supplier: any;
        items: Array<{ rfqItemId: string; productName: string; price: number }>;
        totalPrice: number;
      }
    >();

    for (const itemAward of itemAwards) {
      const rfqItem = rfq.items.find((item) => item.id === itemAward.rfqItemId);
      const quote = rfq.quotes.find((q) => q.id === itemAward.quoteId);
      if (!rfqItem || !quote) continue;

      // 更新商品中标状态
      await this.prisma.rfqItem.update({
        where: { id: itemAward.rfqItemId },
        data: {
          itemStatus: 'AWARDED',
        },
      });

      // 累计每个供应商中标的商品信息（用于通知）
      if (!supplierAwardMap.has(itemAward.supplierId)) {
        supplierAwardMap.set(itemAward.supplierId, {
          supplierId: itemAward.supplierId,
          supplier: quote.supplier,
          items: [],
          totalPrice: 0,
        });
      }
      const supplierAward = supplierAwardMap.get(itemAward.supplierId)!;
      supplierAward.items.push({
        rfqItemId: itemAward.rfqItemId,
        productName: rfqItem.productName,
        price: itemAward.price,
      });
      supplierAward.totalPrice += itemAward.price;
    }

    // 为每个供应商创建 Award 记录（一个 RFQ 可以有多个 Award，每个供应商一个）
    for (const [supplierId, supplierAward] of supplierAwardMap) {
      // 找到该供应商的第一个报价ID（用于 Award 记录）
      const firstQuoteItem = itemAwards.find(item => item.supplierId === supplierId);
      if (!firstQuoteItem) continue;

      const existingAward = await this.prisma.award.findUnique({
        where: {
          rfqId_supplierId: {
            rfqId,
            supplierId: supplierId,
          },
        },
      });

      // ⚠️ 重要：无论Award记录是否存在，都需要重新计算finalPrice
      // 因为可能有些商品在processEvaluate之前就已经通过一口价自动中标了
      // 需要查询该供应商在该RFQ中所有已中标的商品，并计算总价
      const allAwardedItems = await this.prisma.rfqItem.findMany({
        where: {
          rfqId,
          itemStatus: 'AWARDED',
        },
        include: {
          quoteItems: {
            include: {
              quote: {
                select: {
                  id: true,
                  supplierId: true,
                },
              },
            },
          },
        },
      });

      // 批量查询所有Award记录（避免N+1查询）
      const allAwards = await this.prisma.award.findMany({
        where: {
          rfqId,
          supplierId,
          status: { not: 'CANCELLED' },
        },
        include: {
          quote: {
            include: {
              items: true,
            },
          },
        },
      });

      // 计算该供应商实际中标的商品总价
      let actualTotalPrice = 0;
      const actualAwardedItems: Array<{ rfqItemId: string; productName: string; price: number }> = [];
      
      for (const rfqItem of allAwardedItems) {
        if (!rfqItem.quoteItems || rfqItem.quoteItems.length === 0) continue;
        
        // 找到该供应商的报价项
        const supplierQuoteItems = rfqItem.quoteItems.filter(
          qi => qi.quote.supplierId === supplierId
        );
        
        if (supplierQuoteItems.length > 0) {
          // 确定中标报价项：优先查找Award记录中指定的报价项，否则使用最低价
          let bestQuoteItem: any = null;
          
          // 查找Award记录中是否指定了该商品的中标报价项
          for (const award of allAwards) {
            if (award.quote.items && award.quote.items.length > 0) {
              const awardedQuoteItem = award.quote.items.find(qi => qi.rfqItemId === rfqItem.id);
              if (awardedQuoteItem) {
                const matchingQuoteItem = supplierQuoteItems.find(qi => qi.id === awardedQuoteItem.id);
                if (matchingQuoteItem) {
                  bestQuoteItem = matchingQuoteItem;
                  break;
                }
              }
            }
          }
          
          // 如果没有找到Award记录指定的报价项，使用最低价
          if (!bestQuoteItem) {
            bestQuoteItem = supplierQuoteItems.reduce((best, current) => {
              const bestPrice = parseFloat(best.price.toString());
              const currentPrice = parseFloat(current.price.toString());
              return currentPrice < bestPrice ? current : best;
            });
          }
          
          const price = parseFloat(bestQuoteItem.price.toString());
          const quantity = rfqItem.quantity || 1;
          actualTotalPrice += price * quantity;
          actualAwardedItems.push({
            rfqItemId: rfqItem.id,
            productName: rfqItem.productName,
            price: price,
          });
        }
      }

      if (!existingAward) {
        const award = await this.prisma.award.create({
          data: {
            rfqId,
            quoteId: firstQuoteItem.quoteId,
            supplierId: supplierId,
            finalPrice: actualTotalPrice,
            reason:
              '系统自动评标：按商品维度选择最低报价，共 ' +
              actualAwardedItems.length +
              ' 个商品中标',
          },
        });

        // 审计日志
        await this.auditService.log({
          action: 'rfq.award',
          resource: 'Award',
          resourceId: award.id,
          userId: rfq.buyerId || 'SYSTEM',
          details: {
            rfqNo: rfq.rfqNo,
            rfqId,
            supplierId: supplierId,
            supplierName: supplierAward.supplier?.username || '未知供应商',
            itemsCount: actualAwardedItems.length,
            items: actualAwardedItems.map((item) => ({
              rfqItemId: item.rfqItemId,
              productName: item.productName,
              price: item.price,
            })),
            totalPrice: actualTotalPrice,
            reason: '系统自动评标：每个商品独立选择最低价报价作为中标',
          },
        });
      } else {
        // ⚠️ 重要：如果Award记录已存在，需要更新finalPrice
        // 因为可能有些商品在processEvaluate之前就已经通过一口价自动中标了
        await this.prisma.award.update({
          where: { id: existingAward.id },
          data: {
            finalPrice: actualTotalPrice,
            reason: existingAward.reason 
              ? `${existingAward.reason}；系统自动评标更新：共 ${actualAwardedItems.length} 个商品中标`
              : `系统自动评标：按商品维度选择最低报价，共 ${actualAwardedItems.length} 个商品中标`,
            updatedAt: new Date(),
          },
        });
        
        console.log(`[AuctionQueue] 更新了现有 Award 记录 ${existingAward.id}，finalPrice: ${actualTotalPrice}，商品数: ${actualAwardedItems.length}`);
      }
    }

    // 给每个中标供应商发通知
    for (const [supplierId, supplierAward] of supplierAwardMap) {
      const itemNames = supplierAward.items
        .map((item) => item.productName + ' (¥' + item.price.toFixed(2) + ')')
        .join('、');
      const itemsCount = supplierAward.items.length;
      const total = supplierAward.totalPrice;

      try {
        await this.notificationService.create({
          userId: supplierId,
          type: 'QUOTE_AWARDED',
          title: '报价中标通知',
          content:
            '恭喜！您在询价单 ' +
            rfq.rfqNo +
            ' 中有 ' +
            itemsCount +
            ' 个商品中标：' +
            itemNames +
            '，合计 ¥' +
            total.toFixed(2) +
            '。请及时查看并处理。',
          link: '/quotes',
        });
        console.log(`[AuctionQueue] 已发送中标通知给供应商 ${supplierAward.supplier?.username || supplierId}，询价单 ${rfq.rfqNo}，${itemsCount} 个商品中标`);
      } catch (error) {
        console.error(`[AuctionQueue] 发送中标通知失败，供应商 ${supplierId}:`, error);
      }
    }

    // 更新 quote 状态：有任意商品中标就标记为 AWARDED，否则 REJECTED
    const quoteAwardedItemsCount = new Map<string, number>();
    for (const itemAward of itemAwards) {
      const count = quoteAwardedItemsCount.get(itemAward.quoteId) || 0;
      quoteAwardedItemsCount.set(itemAward.quoteId, count + 1);
    }

    // ⚠️ 重要：更新 quote 状态和 price
    for (const quote of rfq.quotes) {
      const awardedCount = quoteAwardedItemsCount.get(quote.id) || 0;
      if (awardedCount > 0) {
        // 重新计算 quote.price，只包含真正中标的商品
        let awardedTotalPrice = 0;
        const quoteItems = await this.prisma.quoteItem.findMany({
          where: {
            quoteId: quote.id,
          },
          include: {
            rfqItem: {
              select: {
                id: true,
                itemStatus: true,
                quantity: true,
              },
            },
          },
        });

        for (const quoteItem of quoteItems) {
          if (quoteItem.rfqItem.itemStatus === 'AWARDED') {
            // 检查该商品是否真的由该报价的供应商中标
            // 这里简化处理：如果商品已中标且该报价包含该商品，就计入总价
            // 更严格的验证在 awardItem 中已经做了
            awardedTotalPrice += parseFloat(quoteItem.price.toString()) * (quoteItem.rfqItem.quantity || 1);
          }
        }

        await this.prisma.quote.update({
          where: { id: quote.id },
          data: { 
            status: 'AWARDED',
            price: awardedTotalPrice, // ⚠️ 重要：更新 price，只包含真正中标的商品
          },
        });
      } else {
        await this.prisma.quote.update({
          where: { id: quote.id },
          data: { status: 'REJECTED' },
        });
      }
    }

    // 检查是否所有商品都已中标，如果是，更新 RFQ 状态为已中标
    const allRfqItems = await this.prisma.rfqItem.findMany({
      where: { rfqId },
    });
    
    const allAwarded = allRfqItems.every(item => 
      item.itemStatus === 'AWARDED' || 
      item.itemStatus === 'CANCELLED' || 
      item.itemStatus === 'OUT_OF_STOCK'
    );
    
      if (allAwarded && rfq.status !== 'AWARDED') {
      await this.prisma.rfq.update({
        where: { id: rfqId },
        data: { status: 'AWARDED' },
      });
      console.log(`[AuctionQueue] RFQ ${rfq.rfqNo} 所有商品已中标，状态已更新为 AWARDED`);
    } else if (!allAwarded) {
      console.log(`[AuctionQueue] RFQ ${rfq.rfqNo} 还有 ${allRfqItems.filter(item => item.itemStatus !== 'AWARDED' && item.itemStatus !== 'CANCELLED' && item.itemStatus !== 'OUT_OF_STOCK').length} 个商品未中标，保持 CLOSED 状态`);
    }
    
    console.log(`[AuctionQueue] 自动评标完成，RFQ ${rfq.rfqNo}，共 ${itemAwards.length} 个商品中标，${unquotedItems.length} 个商品未报价`);

      // 如果有未被任何人报价的商品，通知采购员
      if (unquotedItems.length > 0) {
        const unquotedItemNames = rfq.items
          .filter((item) => unquotedItems.includes(item.id))
          .map((item) => item.productName + ' x ' + (item.quantity ?? 1))
          .join('、');

        await this.notificationService.create({
          userId: rfq.buyerId,
          type: 'RFQ_UNQUOTED_ITEMS',
          title: '询价单存在未报价商品',
          content:
            '询价单 ' +
            rfq.rfqNo +
            ' 已完成自动评标，其中有 ' +
            unquotedItems.length +
            ' 个商品没有任何供应商报价，需要从电商平台采购：' +
            unquotedItemNames,
          link: '/purchase',
        });
      }
    } catch (error) {
      console.error('[AuctionQueue] Error in processEvaluate:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('[AuctionQueue] Error details:', {
        rfqId,
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      // 不抛出错误，避免影响其他定时任务
    }
  }

  /**
   * 处理提醒
   */
  async processRemind(job: any) {
    const { rfqId, supplierId } = job.data;

    if (!rfqId) {
      console.error('[AuctionQueue] RFQ ID is missing in remind job data');
      return;
    }

    const rfq = await this.prisma.rfq.findUnique({
      where: { id: rfqId },
    });

    if (!rfq) {
      console.warn('[AuctionQueue] RFQ not found for remind: ' + rfqId);
      return;
    }

    // 检查是否已经报价
    const quote = await this.prisma.quote.findUnique({
      where: {
        rfqId_supplierId: {
          rfqId,
          supplierId,
        },
      },
    });

    if (!quote || quote.status !== 'SUBMITTED') {
      await this.notificationService.create({
        userId: supplierId,
        type: 'QUOTE_REMINDER',
        title: '报价提醒',
        content: '询价单' + rfq.rfqNo + '即将截标，请及时报价',
        link: '/rfqs/' + rfqId,
      });
    }
  }

  private getBatchDate(date?: Date): string {
    const d = date || new Date();
    return d.toISOString().split('T')[0];
  }
}

/**
 * 导出给 worker.ts 使用的处理函数
 */
export const auctionProcessors = {
  close: async (job: any, auctionQueue: AuctionQueue) => {
    await auctionQueue.processClose(job);
  },
  evaluate: async (job: any, auctionQueue: AuctionQueue) => {
    await auctionQueue.processEvaluate(job);
  },
  remind: async (job: any, auctionQueue: AuctionQueue) => {
    await auctionQueue.processRemind(job);
  },
};
