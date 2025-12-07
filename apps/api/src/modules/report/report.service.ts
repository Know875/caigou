import { Injectable, Logger, Inject, ForbiddenException, BadRequestException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { EcommerceWhereCondition, RfqWhereCondition } from '../../common/types/rfq.types';

interface User {
  id: string;
  role: string;
  storeId?: string | null;
}

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject('REDIS_CLIENT') private redisClient: Redis,
  ) {}

  /**
   * 获取供应商财务看板数据
   * 使用与 findBySupplier 相同的逻辑：基于商品级别的中标判断
   */
  async getSupplierFinancialDashboard(supplierId: string, startDate?: Date, endDate?: Date) {
    // 处理开始时间：设置为当天的 00:00:00
    let start = startDate || new Date(new Date().setMonth(new Date().getMonth() - 1));
    if (startDate) {
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
    }
    
    // 处理结束时间：设置为当天的 23:59:59.999，确保包含当天的所有数据
    let end = endDate || new Date();
    if (endDate) {
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    }

    // 查询该供应商的所有报价（与 findBySupplier 逻辑一致）
    // 先不限制时间范围，查询所有报价，然后在处理时过滤
    const quotes = await this.prisma.quote.findMany({
      where: {
        supplierId,
      },
      include: {
        rfq: {
          include: {
            items: {
              include: {
                shipments: {
                  where: { supplierId },
                  include: {
                    packages: true,
                    settlements: {
                      orderBy: { createdAt: 'desc' },
                    },
                  },
                },
              },
            },
          },
        },
        items: {
          include: {
            rfqItem: true,
          },
        },
      },
      orderBy: {
        submittedAt: 'desc',
      },
    });

    // 统计信息
    let totalAmount = 0; // 总中标金额
    let pendingAmount = 0; // 待收款金额
    let paidAmount = 0; // 已收款金额
    let shippedCount = 0; // 已发货数量
    let pendingShipmentCount = 0; // 待发货数量

    const items: Array<{
      awardId: string;
      rfqNo: string;
      rfqTitle: string;
      productName: string;
      quantity: number;
      price: number;
      amount: number;
      trackingNo?: string;
      carrier?: string;
      shipmentStatus?: string;
      settlementStatus?: string;
      settlementAmount?: number;
      paidAt?: Date;
      createdAt: Date;
      shipmentId?: string;
      settlementId?: string;
    }> = [];

    // 收集所有需要查询的rfqItemId，避免N+1查询
    const awardedRfqItemIds = new Set<string>();
    
    for (const quote of quotes) {
      // 检查时间范围：基于 RFQ 的 closeTime 或 createdAt
      const rfqTime = quote.rfq.closeTime || quote.rfq.createdAt;
      const rfqTimeMs = rfqTime.getTime();
      const startMs = start.getTime();
      const endMs = end.getTime();
      
      if (rfqTimeMs < startMs || rfqTimeMs > endMs) {
        continue;
      }
      
      // 只处理已截标或已中标的询价单
      if (quote.rfq.status !== 'CLOSED' && quote.rfq.status !== 'AWARDED') {
        continue;
      }

      // 收集所有中标商品的ID
      for (const quoteItem of quote.items) {
        const rfqItem = quoteItem.rfqItem;
        if (!rfqItem) {
          continue;
        }

        if (rfqItem.itemStatus === 'AWARDED') {
          awardedRfqItemIds.add(rfqItem.id);
        }
      }
    }

    // 批量查询所有中标商品的所有报价（避免N+1查询）
    // ⚠️ 重要：需要包含 submittedAt 和 createdAt，以便后续处理一口价和提交时间排序
    const allQuoteItemsMap = new Map<string, Array<{
      id: string;
      price: any;
      quote: { id: string; supplierId: string; submittedAt: Date | null; createdAt: Date };
    }>>();

    if (awardedRfqItemIds.size > 0) {
      const allQuoteItems = await this.prisma.quoteItem.findMany({
        where: {
          rfqItemId: { in: Array.from(awardedRfqItemIds) },
        },
        include: {
          quote: {
            select: {
              id: true,
              supplierId: true,
              submittedAt: true,
              createdAt: true,
            },
          },
        },
        orderBy: {
          price: 'asc', // 在数据库层面排序
        },
      });

      // 按rfqItemId分组
      for (const quoteItem of allQuoteItems) {
        const rfqItemId = quoteItem.rfqItemId;
        if (!allQuoteItemsMap.has(rfqItemId)) {
          allQuoteItemsMap.set(rfqItemId, []);
        }
        allQuoteItemsMap.get(rfqItemId)!.push({
          id: quoteItem.id,
          price: quoteItem.price,
          quote: quoteItem.quote,
        });
      }
    }

    // 按商品级别检查中标（与 findBySupplier 逻辑一致）
    for (const quote of quotes) {
      // 检查时间范围：基于 RFQ 的 closeTime 或 createdAt
      const rfqTime = quote.rfq.closeTime || quote.rfq.createdAt;
      const rfqTimeMs = rfqTime.getTime();
      const startMs = start.getTime();
      const endMs = end.getTime();
      
      if (rfqTimeMs < startMs || rfqTimeMs > endMs) {
        continue;
      }
      
      // 只处理已截标或已中标的询价单
      if (quote.rfq.status !== 'CLOSED' && quote.rfq.status !== 'AWARDED') {
        continue;
      }

      // 遍历该报价的所有商品，检查每个商品是否中标
      for (const quoteItem of quote.items) {
        const rfqItem = quoteItem.rfqItem;
        if (!rfqItem) {
          continue;
        }

        // 如果该商品的状态是 AWARDED，验证该供应商是否真的是中标供应商
        if (rfqItem.itemStatus === 'AWARDED') {
          const allQuotesForItem = allQuoteItemsMap.get(rfqItem.id) || [];

          if (allQuotesForItem.length === 0) {
            continue;
          }

          // ⚠️ 重要：使用与 findBySupplier 相同的逻辑确定中标供应商
          // 1. 优先查找 Award 记录，确定中标供应商（支持手动选商和一口价）
          // 2. 如果没有 Award 记录，考虑一口价的情况（优先选择满足一口价且最早提交的）
          // 3. 如果没有满足一口价的，使用价格最低的报价（价格相同，按提交时间排序）
          const rfqId = quote.rfq.id;
          let bestQuoteItem: any = null;

          // 优先查找 Award 记录
          const allAwards = await this.prisma.award.findMany({
            where: {
              rfqId: rfqId,
              status: { not: 'CANCELLED' },
            },
            include: {
              quote: {
                include: {
                  items: {
                    where: {
                      rfqItemId: rfqItem.id,
                    },
                  },
                },
              },
            },
          });

          // 通过 Award 记录找到真正中标该商品的供应商
          for (const quoteItemCandidate of allQuotesForItem) {
            const matchingAward = allAwards.find(award => {
              if (award.quoteId !== quoteItemCandidate.quote.id) {
                return false;
              }
              if (!award.quote.items || award.quote.items.length === 0) {
                return false;
              }
              return award.quote.items.some((qi: any) => qi.id === quoteItemCandidate.id);
            });

            if (matchingAward) {
              bestQuoteItem = quoteItemCandidate;
              this.logger.debug(`getSupplierFinancialDashboard: 通过 Award 记录找到中标报价项: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`);
              break;
            }
          }

          // 如果没有找到 Award 记录，考虑一口价的情况
          if (!bestQuoteItem) {
            const instantPrice = rfqItem.instantPrice ? parseFloat(rfqItem.instantPrice.toString()) : null;
            
            if (instantPrice) {
              // 如果有一口价，优先选择满足一口价的报价，按提交时间排序（最早提交的优先）
              const instantPriceQuotes = allQuotesForItem
                .filter((item: any) => parseFloat(item.price.toString()) <= instantPrice)
                .sort((a: any, b: any) => {
                  const timeA = a.quote.submittedAt || a.quote.createdAt || new Date(0);
                  const timeB = b.quote.submittedAt || b.quote.createdAt || new Date(0);
                  return new Date(timeA).getTime() - new Date(timeB).getTime();
                });
              
              if (instantPriceQuotes.length > 0) {
                bestQuoteItem = instantPriceQuotes[0];
                this.logger.debug(`getSupplierFinancialDashboard: 未找到 Award 记录，使用满足一口价且最早提交的报价: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`);
              }
            }

            // 如果没有满足一口价的，使用价格最低的报价（价格相同，按提交时间排序）
            if (!bestQuoteItem) {
              const sortedQuoteItems = allQuotesForItem.sort((a: any, b: any) => {
                const priceA = parseFloat(a.price.toString());
                const priceB = parseFloat(b.price.toString());
                if (priceA !== priceB) {
                  return priceA - priceB;
                }
                const timeA = a.quote.submittedAt || a.quote.createdAt || new Date(0);
                const timeB = b.quote.submittedAt || b.quote.createdAt || new Date(0);
                return new Date(timeA).getTime() - new Date(timeB).getTime();
              });
              bestQuoteItem = sortedQuoteItems[0];
              this.logger.debug(`getSupplierFinancialDashboard: 未找到 Award 记录，使用最低报价: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`);
            }
          }

          // 如果该供应商的报价是中标报价，则说明中标
          if (bestQuoteItem && bestQuoteItem.quote.supplierId === supplierId && bestQuoteItem.id === quoteItem.id) {
            const itemAmount = Number(quoteItem.price) * (rfqItem.quantity || 1);
            totalAmount += itemAmount;

            // 查找发货单 - 从 quote.rfq.items 中获取（因为那里已经包含 shipments 关系）
            const rfqItemWithShipments = quote.rfq.items.find(item => item.id === rfqItem.id);
            const shipment = rfqItemWithShipments?.shipments?.find(s => s.supplierId === supplierId);
            const settlement = shipment?.settlements?.[0];

            if (shipment) {
              if (
                shipment.status === 'SHIPPED' ||
                shipment.status === 'IN_TRANSIT' ||
                shipment.status === 'DELIVERED' ||
                shipment.status === 'RECEIVED'
              ) {
                shippedCount++;
              } else {
                pendingShipmentCount++;
              }
            } else {
              pendingShipmentCount++;
            }

            // 结算状态判断逻辑：
            // - 已付款：结算记录存在且有付款截图（qrCodeUrl）
            // - 待付款：发货单存在且已上传物流单号（trackingNo）
            if (settlement && settlement.qrCodeUrl) {
              // 有结算记录且有付款截图，算作已付款
              paidAmount += itemAmount;
            } else if (shipment && shipment.trackingNo && shipment.trackingNo.trim() !== '') {
              // 有发货单且已上传物流单号，算作待付款
              pendingAmount += itemAmount;
            }
            // 如果没有发货单或没有物流单号，不计入待付款和已付款

            // 确定结算状态：根据是否有付款截图
            let settlementStatus: string | undefined;
            if (settlement && settlement.qrCodeUrl) {
              settlementStatus = 'PAID'; // 有付款截图，算作已付款
            } else if (shipment && shipment.trackingNo && shipment.trackingNo.trim() !== '') {
              settlementStatus = 'PENDING'; // 有物流单号，算作待付款
            }

            items.push({
              awardId: `virtual-${quote.rfq.id}-${supplierId}`, // 虚拟 Award ID
              rfqNo: quote.rfq.rfqNo,
              rfqTitle: quote.rfq.title || '',
              productName: rfqItem.productName,
              quantity: rfqItem.quantity || 1,
              price: Number(quoteItem.price),
              amount: itemAmount,
              trackingNo: shipment?.trackingNo || undefined,
              carrier: shipment?.carrier || undefined,
              shipmentStatus: shipment?.status || undefined,
              settlementStatus: settlementStatus,
              settlementAmount: settlement ? Number(settlement.amount) : undefined,
              paidAt: settlement?.qrCodeUrl ? (settlement.paidAt || settlement.updatedAt) : undefined,
              createdAt: quote.rfq.closeTime || quote.rfq.createdAt || quote.submittedAt || quote.createdAt,
              shipmentId: shipment?.id || undefined,
              settlementId: settlement?.id || undefined,
            });
          }
        }
      }
    }

    // 添加从库存下单的订单数据（source: 'ECOMMERCE'）
    // 注意：查询条件要求订单必须有该供应商的发货单
    const inventoryOrders = await this.prisma.order.findMany({
      where: {
        source: 'ECOMMERCE', // 从库存下单的订单
        orderTime: {
          gte: start,
          lte: end,
        },
        shipments: {
          some: {
            supplierId, // 只查询该供应商的发货单
            source: 'ECOMMERCE', // 从库存下单的发货单
          },
        },
      },
      include: {
        store: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        shipments: {
          where: {
            supplierId,
            source: 'ECOMMERCE',
          },
          include: {
            settlements: {
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        },
      },
      orderBy: {
        orderTime: 'desc',
      },
    });

    this.logger.debug(`getSupplierFinancialDashboard: 查询到 ${inventoryOrders.length} 个库存订单`, {
      supplierId,
      start: start.toISOString(),
      end: end.toISOString(),
      orderIds: inventoryOrders.map(o => ({ id: o.id, orderNo: o.orderNo, orderTime: o.orderTime })),
    });

    // 处理库存订单数据
    let inventoryOrderCount = 0;
    let inventoryTotalAmount = 0;
    let inventoryPendingAmount = 0;
    let inventoryPaidAmount = 0;
    
    for (const order of inventoryOrders) {
      const shipment = order.shipments?.[0]; // 通常只有一个发货单
      if (!shipment) {
        this.logger.warn(`getSupplierFinancialDashboard: 订单 ${order.id} (${order.orderNo}) 没有发货单，跳过`);
        continue;
      }

      const orderAmount = Number(order.price) || 0;
      // 注意：Order 模型可能没有 quantity 字段，默认为 1
      const orderQuantity = (order as any).quantity || 1;
      const itemAmount = orderAmount * orderQuantity;
      
      inventoryOrderCount++;
      inventoryTotalAmount += itemAmount;
      
      this.logger.debug(`getSupplierFinancialDashboard: 处理库存订单 ${order.id}`, {
        orderNo: order.orderNo,
        orderTime: order.orderTime,
        orderAmount,
        orderQuantity,
        itemAmount,
        shipmentId: shipment.id,
        trackingNo: shipment.trackingNo,
        shipmentStatus: shipment.status,
        hasSettlement: !!shipment.settlements?.[0],
        settlementQrCodeUrl: shipment.settlements?.[0]?.qrCodeUrl,
      });
      
      totalAmount += itemAmount;

      // 统计发货状态
      if (
        shipment.status === 'SHIPPED' ||
        shipment.status === 'IN_TRANSIT' ||
        shipment.status === 'DELIVERED' ||
        shipment.status === 'RECEIVED'
      ) {
        shippedCount++;
      } else {
        pendingShipmentCount++;
      }

      // 结算状态判断
      const settlement = shipment.settlements?.[0];
      if (settlement && settlement.qrCodeUrl) {
        // 有结算记录且有付款截图，算作已付款
        paidAmount += itemAmount;
        inventoryPaidAmount += itemAmount;
        this.logger.debug(`getSupplierFinancialDashboard: 订单 ${order.orderNo} 已付款，金额: ${itemAmount}`);
      } else if (shipment.trackingNo && shipment.trackingNo.trim() !== '') {
        // 有发货单且已上传物流单号，算作待付款
        pendingAmount += itemAmount;
        inventoryPendingAmount += itemAmount;
        this.logger.debug(`getSupplierFinancialDashboard: 订单 ${order.orderNo} 待付款（已上传单号），金额: ${itemAmount}`);
      } else {
        this.logger.debug(`getSupplierFinancialDashboard: 订单 ${order.orderNo} 未上传单号，不计入待付款和已付款`);
      }

      // 确定结算状态
      let settlementStatus: string | undefined;
      if (settlement && settlement.qrCodeUrl) {
        settlementStatus = 'PAID';
      } else if (shipment.trackingNo && shipment.trackingNo.trim() !== '') {
        settlementStatus = 'PENDING';
      }

      items.push({
        awardId: `inventory-${order.id}`, // 虚拟 Award ID
        rfqNo: `INV-${order.orderNo}`, // 使用订单号作为RFQ号
        rfqTitle: '供应商库存采购',
        productName: order.productName || '未知商品',
        quantity: orderQuantity,
        price: orderAmount,
        amount: itemAmount,
        trackingNo: shipment.trackingNo || undefined,
        carrier: shipment.carrier || undefined,
        shipmentStatus: shipment.status || undefined,
        settlementStatus: settlementStatus,
        settlementAmount: settlement ? Number(settlement.amount) : undefined,
        paidAt: settlement?.qrCodeUrl ? (settlement.paidAt || settlement.updatedAt) : undefined,
        createdAt: order.orderTime || order.createdAt,
        shipmentId: shipment.id,
        settlementId: settlement?.id || undefined,
      });
    }

    // 按时间段统计
    const dailyStats: Record<string, { date: string; amount: number; count: number }> = {};
    items.forEach((item) => {
      const date = new Date(item.createdAt).toISOString().split('T')[0];
      if (!dailyStats[date]) {
        dailyStats[date] = { date, amount: 0, count: 0 };
      }
      dailyStats[date].amount += item.amount;
      dailyStats[date].count += 1;
    });

    this.logger.debug(`getSupplierFinancialDashboard: 统计完成`, {
      supplierId,
      rfqItemsCount: items.length - inventoryOrderCount,
      inventoryOrdersCount: inventoryOrderCount,
      totalItems: items.length,
      totalAmount,
      pendingAmount,
      paidAmount,
      shippedCount,
      pendingShipmentCount,
      inventoryStats: {
        count: inventoryOrderCount,
        totalAmount: inventoryTotalAmount,
        pendingAmount: inventoryPendingAmount,
        paidAmount: inventoryPaidAmount,
      },
    });

    return {
      summary: {
        totalAmount,
        pendingAmount,
        paidAmount,
        shippedCount,
        pendingShipmentCount,
        totalItems: items.length,
      },
      items,
      dailyStats: Object.values(dailyStats).sort((a, b) => a.date.localeCompare(b.date)),
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
  }

  /**
   * 获取所有供应商的财务看板数据（管理员和采购员使用）
   */
  async getAllSuppliersFinancialDashboard(startDate?: Date, endDate?: Date) {
    // 处理开始时间：设置为当天的 00:00:00
    let start = startDate || new Date(new Date().setMonth(new Date().getMonth() - 1));
    if (startDate) {
      start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
    }
    
    // 处理结束时间：设置为当天的 23:59:59.999
    let end = endDate || new Date();
    if (endDate) {
      end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
    }

    // 查询所有已发货的发货单（有物流单号的）
    const shipments = await this.prisma.shipment.findMany({
      where: {
        AND: [
          { trackingNo: { not: null } },
          { trackingNo: { not: '' } },
        ],
        createdAt: {
          gte: start,
          lte: end,
        },
      },
      include: {
        rfqItem: {
          include: {
            rfq: {
              include: {
                items: {
                  include: {
                    quoteItems: {
                      include: {
                        quote: {
                          include: {
                            supplier: {
                              select: {
                                id: true,
                                username: true,
                              },
                            },
                          },
                        },
                      },
                      orderBy: {
                        price: 'asc',
                      },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
        settlements: {
          orderBy: { createdAt: 'desc' },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 统计信息
    let totalAmount = 0;
    let pendingAmount = 0;
    let paidAmount = 0;
    let shippedCount = 0;
    let pendingShipmentCount = 0;

    const items: Array<{
      awardId: string;
      rfqNo: string;
      rfqTitle: string;
      productName: string;
      quantity: number;
      price: number;
      amount: number;
      trackingNo?: string;
      carrier?: string;
      shipmentStatus?: string;
      settlementStatus?: string;
      settlementAmount?: number;
      paidAt?: Date;
      createdAt: Date;
      shipmentId?: string;
      settlementId?: string;
    }> = [];

    for (const shipment of shipments) {
      if (!shipment.rfqItem) continue;

      const rfqItem = shipment.rfqItem;
      if (!rfqItem.rfq) {
        // 如果 rfqItem 关联的 rfq 不存在（可能被删除），跳过
        continue;
      }
      const rfq = rfqItem.rfq;
      
      // 获取报价信息
      if (!rfq.items || rfq.items.length === 0) continue;
      
      const rfqItemWithQuotes = rfq.items.find(item => item.id === rfqItem.id);
      if (!rfqItemWithQuotes?.quoteItems || rfqItemWithQuotes.quoteItems.length === 0) continue;

      const bestQuoteItem = rfqItemWithQuotes.quoteItems[0];
      const itemAmount = parseFloat(bestQuoteItem.price.toString()) * (rfqItem.quantity || 1);
      totalAmount += itemAmount;

      // 发货状态统计
      if (
        shipment.status === 'SHIPPED' ||
        shipment.status === 'IN_TRANSIT' ||
        shipment.status === 'DELIVERED' ||
        shipment.status === 'RECEIVED'
      ) {
        shippedCount++;
      } else {
        pendingShipmentCount++;
      }

      // 结算状态
      const settlement = shipment.settlements?.[0];
      let settlementStatus: string | undefined;
      
      if (settlement && settlement.qrCodeUrl) {
        settlementStatus = 'PAID';
        paidAmount += itemAmount;
      } else if (shipment.trackingNo && shipment.trackingNo.trim() !== '') {
        settlementStatus = 'PENDING';
        pendingAmount += itemAmount;
      }

      items.push({
        awardId: `virtual-${rfq.id}-${shipment.supplierId || 'unknown'}`,
        rfqNo: rfq.rfqNo,
        rfqTitle: rfq.title || '',
        productName: rfqItem.productName,
        quantity: rfqItem.quantity || 1,
        price: Number(bestQuoteItem.price),
        amount: itemAmount,
        trackingNo: shipment.trackingNo || undefined,
        carrier: shipment.carrier || undefined,
        shipmentStatus: shipment.status || undefined,
        settlementStatus: settlementStatus,
        settlementAmount: settlement ? Number(settlement.amount) : undefined,
        paidAt: settlement?.qrCodeUrl ? (settlement.paidAt || settlement.updatedAt) : undefined,
        createdAt: shipment.createdAt,
        shipmentId: shipment.id,
        settlementId: settlement?.id || undefined,
      });
    }

    return {
      summary: {
        totalAmount,
        pendingAmount,
        paidAmount,
        shippedCount,
        pendingShipmentCount,
        totalItems: items.length,
      },
      items,
      dailyStats: [],
      period: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
  }

  /**
   * 竞价节省率
   */
  async getAuctionSavingsRate(startDate?: Date, endDate?: Date) {
    const start = startDate || new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate || new Date();

    const rfqs = await this.prisma.rfq.findMany({
      where: {
        type: 'AUCTION',
        status: 'AWARDED',
        closeTime: {
          gte: start,
          lte: end,
        },
      },
      include: {
        items: {
          include: {
            quoteItems: {
              include: {
                quote: true,
              },
            },
          },
        },
      },
    });

    let totalOriginalPrice = 0;
    let totalAwardedPrice = 0;

    rfqs.forEach((rfq) => {
      rfq.items.forEach((item) => {
        if (item.itemStatus === 'AWARDED' && item.quoteItems.length > 0) {
          // 找到最低报价
          const bestQuote = item.quoteItems.reduce((best, current) => {
            const bestPrice = Number(best.price);
            const currentPrice = Number(current.price);
            return currentPrice < bestPrice ? current : best;
          });

          const quantity = item.quantity || 1;
          const awardedPrice = Number(bestQuote.price) * quantity;
          totalAwardedPrice += awardedPrice;

          // 如果有最高限价，使用最高限价作为原始价格
          if (item.maxPrice) {
            totalOriginalPrice += Number(item.maxPrice) * quantity;
          } else {
            // 否则使用所有报价的平均价
            const avgPrice =
              item.quoteItems.reduce((sum, q) => sum + Number(q.price), 0) /
              item.quoteItems.length;
            totalOriginalPrice += avgPrice * quantity;
          }
        }
      });
    });

    const savings = totalOriginalPrice - totalAwardedPrice;
    const savingsRate = totalOriginalPrice > 0 ? (savings / totalOriginalPrice) * 100 : 0;

    return {
      totalOriginalPrice,
      totalAwardedPrice,
      savings,
      savingsRate: Number(savingsRate.toFixed(2)),
      rfqCount: rfqs.length,
    };
  }

  /**
   * 准时率
   */
  async getOnTimeRate(startDate?: Date, endDate?: Date) {
    const start = startDate || new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate || new Date();

    const rfqs = await this.prisma.rfq.findMany({
      where: {
        status: 'AWARDED',
        closeTime: {
          gte: start,
          lte: end,
        },
      },
      include: {
        items: {
          include: {
            shipments: {
              where: {
                source: 'SUPPLIER',
              },
            },
          },
        },
      },
    });

    let onTimeCount = 0;
    let totalCount = 0;

    rfqs.forEach((rfq) => {
      rfq.items.forEach((item) => {
        if (item.itemStatus === 'AWARDED' && item.shipments.length > 0) {
          totalCount++;
          const shipment = item.shipments[0];
          if (shipment.shippedAt) {
            const shippedDate = new Date(shipment.shippedAt);
            const deadline = rfq.deadline;
            if (deadline && shippedDate <= deadline) {
              onTimeCount++;
            }
          }
        }
      });
    });

    const onTimeRate = totalCount > 0 ? (onTimeCount / totalCount) * 100 : 0;

    return {
      onTimeCount,
      totalCount,
      onTimeRate: Number(onTimeRate.toFixed(2)),
    };
  }

  /**
   * 售后率
   */
  async getAfterSalesRate(startDate?: Date, endDate?: Date) {
    const start = startDate || new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate || new Date();

    const rfqs = await this.prisma.rfq.findMany({
      where: {
        status: 'AWARDED',
        closeTime: {
          gte: start,
          lte: end,
        },
      },
      include: {
        items: true,
      },
    });

    const totalItems = rfqs.reduce(
      (sum, rfq) =>
        sum + rfq.items.filter(item => item.itemStatus === 'AWARDED').length,
      0,
    );

    const afterSalesCases = await this.prisma.afterSalesCase.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
        status: {
          not: 'CANCELLED',
        },
      },
    });

    const afterSalesRate = totalItems > 0 ? (afterSalesCases.length / totalItems) * 100 : 0;

    return {
      totalItems,
      afterSalesCount: afterSalesCases.length,
      afterSalesRate: Number(afterSalesRate.toFixed(2)),
    };
  }

  /**
   * 责任分布
   */
  async getResponsibilityDistribution(startDate?: Date, endDate?: Date) {
    const start = startDate || new Date(new Date().setMonth(new Date().getMonth() - 1));
    const end = endDate || new Date();

    const afterSales = await this.prisma.afterSalesCase.findMany({
      where: {
        createdAt: {
          gte: start,
          lte: end,
        },
        status: {
          not: 'CANCELLED',
        },
      },
      include: {
        shipment: {
          include: {
            supplier: true,
          },
        },
      },
    });

    const distribution = {
      supplier: 0,
      ecommerce: 0,
      other: 0,
      total: afterSales.length,
    };

    afterSales.forEach((case_) => {
      if (case_.shipment) {
        if (case_.shipment.source === 'SUPPLIER') {
          distribution.supplier++;
        } else if (case_.shipment.source === 'ECOMMERCE') {
          distribution.ecommerce++;
        } else {
          distribution.other++;
        }
      } else {
        distribution.other++;
      }
    });

    return distribution;
  }

  /**
   * 财务报表：显示每个供应商需要付款多少钱，电商平台采购了多少钱
   * 使用商品级别的中标逻辑
   * 支持日报、周报、月报
   * 
   * @param date 目标日期
   * @param storeId 门店ID（可选）
   * @param period 报表周期
   * @param user 当前用户（用于权限验证）
   */
  async getFinancialReport(
    date?: Date,
    storeId?: string,
    period: 'day' | 'week' | 'month' = 'day',
    user?: User,
  ) {
    // 权限验证
    if (user) {
      if (user.role === 'STORE' && user.storeId) {
        // 门店用户只能查看自己门店的数据
        if (storeId && storeId !== user.storeId) {
          throw new ForbiddenException('无权访问该门店的财务报表');
        }
        storeId = user.storeId;
      } else if (user.role === 'SUPPLIER') {
        throw new ForbiddenException('供应商无权访问财务报表');
      }
    }

    // 参数验证
    if (period && !['day', 'week', 'month'].includes(period)) {
      throw new BadRequestException('无效的报表周期');
    }

    if (date && isNaN(date.getTime())) {
      throw new BadRequestException('无效的日期');
    }

    try {
      const targetDate = date || new Date();
      let startTime: Date;
      let endTime: Date;
      let periodLabel: string;

      if (period === 'week') {
        // 周报：找到目标日期所在周的周一和周日
        const dayOfWeek = targetDate.getDay();
        const diff = dayOfWeek === 0 ? -6 : 1 - dayOfWeek; // 周一
        const monday = new Date(targetDate);
        monday.setDate(targetDate.getDate() + diff);
        monday.setHours(0, 0, 0, 0);
        startTime = monday;
        
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        endTime = sunday;
        
        periodLabel = `${monday.toISOString().split('T')[0]} 至 ${sunday.toISOString().split('T')[0]}`;
      } else if (period === 'month') {
        // 月报：目标日期所在月的第一天和最后一天
        const firstDay = new Date(targetDate.getFullYear(), targetDate.getMonth(), 1);
        firstDay.setHours(0, 0, 0, 0);
        startTime = firstDay;
        
        const lastDay = new Date(targetDate.getFullYear(), targetDate.getMonth() + 1, 0);
        lastDay.setHours(23, 59, 59, 999);
        endTime = lastDay;
        
        periodLabel = `${targetDate.getFullYear()}年${targetDate.getMonth() + 1}月`;
      } else {
        // 日报：默认
        startTime = new Date(targetDate);
        startTime.setHours(0, 0, 0, 0);
        endTime = new Date(targetDate);
        endTime.setHours(23, 59, 59, 999);
        periodLabel = targetDate.toISOString().split('T')[0];
      }

      // 检查缓存（历史数据缓存24小时，当天数据缓存5分钟）
      const dateStr = targetDate.toISOString().split('T')[0];
      const todayStr = new Date().toISOString().split('T')[0];
      const isHistorical = dateStr < todayStr;
      const cacheKey = `financial_report:${period}:${dateStr}:${storeId || 'all'}`;
      const cacheTTL = isHistorical ? 24 * 60 * 60 : 5 * 60; // 历史数据24小时（秒），当天数据5分钟（秒）

      try {
        // 使用Redis直接查询缓存
        const cached = await this.redisClient.get(cacheKey);
        if (cached) {
          this.logger.debug(`getFinancialReport: 从缓存获取数据，key: ${cacheKey}`);
          return JSON.parse(cached);
        }
      } catch (cacheError) {
        this.logger.warn(`getFinancialReport: 缓存读取失败，继续查询数据库`, cacheError);
      }

      this.logger.debug(
        `getFinancialReport 开始，日期: ${targetDate.toISOString().split('T')[0]}，周期: ${period}，门店ID: ${
          storeId || 'ALL'
        }，时间范围: ${startTime.toISOString()} - ${endTime.toISOString()}`,
      );

      // 构建查询条件
      const where: any = {
        status: {
          in: ['CLOSED', 'AWARDED'],
        },
        closeTime: {
          not: null,
          gte: startTime,
          lte: endTime,
        },
      };

      // 如果指定了门店，添加门店筛选
      if (storeId && storeId.trim() !== '') {
        where.storeId = storeId.trim();
        this.logger.debug(
          `getFinancialReport: 添加门店筛选条件，storeId: ${storeId.trim()}`,
        );
      } else {
        this.logger.debug('getFinancialReport: 未指定门店，查询所有门店的数据');
      }

      // 查询所有已截标或已中标的询价单，且截标时间在目标日期范围内
      const rfqs = await this.prisma.rfq.findMany({
        where,
        include: {
          store: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          items: {
            where: {
              itemStatus: 'AWARDED',
            },
            include: {
              quoteItems: {
                include: {
                  quote: {
                    select: {
                      id: true,
                      supplierId: true,
                      submittedAt: true,
                      createdAt: true,
                      supplier: {
                        select: {
                          id: true,
                          username: true,
                          email: true,
                        },
                      },
                    },
                  },
                },
              },
              shipments: {
                where: {
                  source: 'SUPPLIER',
                },
                include: {
                  settlements: {
                    orderBy: { createdAt: 'desc' },
                  },
                },
              },
            },
          },
        },
      });

      this.logger.debug(`getFinancialReport: 查询到 ${rfqs.length} 个RFQ`);
      if (rfqs.length > 0 && process.env.NODE_ENV === 'development') {
        rfqs.forEach((rfq, idx) => {
          this.logger.debug(
            `RFQ[${idx}]: ${rfq.rfqNo}, storeId: ${rfq.storeId}, storeName: ${rfq.store?.name || 'N/A'}`,
          );
        });
      }

      // 按供应商分组，然后按 RFQ+供应商+门店 分组（每个RFQ+供应商+门店组合一个付款项）
      const supplierPayments: Record<string, {
        supplierId: string;
        supplierName: string;
        totalAmount: number;
        awardCount: number;
        rfqGroups: Array<{
          rfqId: string;
          rfqNo: string;
          rfqTitle?: string;
          storeId?: string;
          storeName?: string;
          storeCode?: string;
          totalAmount: number;
          shipmentIds: string[];
          settlementId?: string;
          hasPaymentScreenshot: boolean;
          paymentScreenshotUrl?: string;
          paymentQrCodeUrl?: string; // 供应商上传的收款二维码URL
          items: Array<{
            rfqItemId: string;
            productName: string;
            quantity: number;
            price: number;
            trackingNo?: string;
            carrier?: string;
            shipmentId?: string;
          }>;
        }>;
      }> = {};

      // 用于跟踪每个商品是否已经被分配（防止重复计算）
      const processedRfqItems = new Set<string>();

      // 遍历所有询价单的中标商品
      for (const rfq of rfqs) {
        // 如果指定了门店，再次验证 RFQ 是否属于该门店（双重检查）
        if (storeId && storeId.trim() !== '') {
          if (rfq.storeId !== storeId.trim()) {
            this.logger.warn(
              `getFinancialReport: RFQ ${rfq.id} 的门店ID (${rfq.storeId}) 与筛选条件 (${storeId.trim()}) 不匹配，跳过`,
            );
            continue;
          }
          this.logger.debug(
            `getFinancialReport: RFQ ${rfq.id} 通过门店筛选，storeId: ${rfq.storeId}, storeName: ${rfq.store?.name}`,
          );
        }
        
        for (const rfqItem of rfq.items) {
          // 检查该商品是否已经被处理过（防止重复）
          if (processedRfqItems.has(rfqItem.id)) {
            this.logger.warn(`商品 ${rfqItem.id} 已被处理过，跳过重复计算`);
            continue;
          }

          if (rfqItem.itemStatus !== 'AWARDED' || !rfqItem.quoteItems || rfqItem.quoteItems.length === 0) {
            continue;
          }

          // ⚠️ 重要：使用与 getSupplierFinancialDashboard 和 findBySupplier 相同的逻辑确定中标供应商
          // 1. 优先查找 Award 记录，确定中标供应商（支持手动选商和一口价）
          // 2. 如果没有 Award 记录，考虑一口价的情况（优先选择满足一口价且最早提交的）
          // 3. 如果没有满足一口价的，使用价格最低的报价（价格相同，按提交时间排序）
          
          // 过滤掉无效的报价项
          const validQuoteItems = rfqItem.quoteItems.filter(
            item => item && item.quote && item.quote.supplier && item.price != null,
          );

          if (validQuoteItems.length === 0) {
            continue;
          }

          let bestQuoteItem: any = null;

          // 优先查找 Award 记录
          // ⚠️ 重要：不要使用 where 过滤 quote.items，因为我们需要检查 Award 的 quote 中是否包含该报价项
          const allAwards = await this.prisma.award.findMany({
            where: {
              rfqId: rfq.id,
              status: { not: 'CANCELLED' },
            },
            include: {
              quote: {
                include: {
                  items: true, // 包含所有报价项，不进行过滤
                },
              },
            },
            // 注意：不能同时使用 select 和 include，所以使用 include 并确保 paymentQrCodeUrl 被包含
          });

          // 通过 Award 记录找到真正中标该商品的供应商
          // ⚠️ 重要：如果有多个 Award 都包含该商品，应该选择价格最低的（符合业务逻辑）
          const matchedQuoteItems: Array<{ quoteItem: any; price: number; submittedAt: Date | null; award?: any }> = [];
          
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug(
              `getFinancialReport: 商品 ${rfqItem.id} (${rfqItem.productName}) 共有 ${validQuoteItems.length} 个有效报价，${allAwards.length} 个 Award 记录`,
            );
            validQuoteItems.forEach((qi: any) => {
              this.logger.debug(
                `getFinancialReport: 报价项 ${qi.id}，供应商: ${qi.quote.supplier?.username || qi.quote.supplierId}, 价格: ¥${qi.price}`,
              );
            });
          }
          
          for (const quoteItemCandidate of validQuoteItems) {
            const matchingAward = allAwards.find(award => {
              if (award.quoteId !== quoteItemCandidate.quote.id) {
                return false;
              }
              if (!award.quote.items || award.quote.items.length === 0) {
                return false;
              }
              // 检查 Award 的 quote 中是否包含该报价项，且该报价项对应的 rfqItemId 匹配
              const hasMatchingItem = award.quote.items.some((qi: any) => 
                qi.id === quoteItemCandidate.id && qi.rfqItemId === rfqItem.id
              );
              
              if (!hasMatchingItem) {
                return false;
              }
              
              // ⚠️ 重要：检查 Award 的 reason 字段，如果明确说明该商品已被移除，则不匹配
              // 例如："已移除商品：MG重炮手" 或 "已移除商品：XXX"
              if (award.reason && typeof award.reason === 'string') {
                // 转义商品名称中的特殊字符
                const escapedProductName = rfqItem.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                // 匹配 "已移除商品：" 或 "已移除商品：" 后跟商品名称
                const removedPattern = new RegExp(`已移除商品[：:][^；;]*?${escapedProductName}`, 'i');
                if (removedPattern.test(award.reason)) {
                  if (process.env.NODE_ENV === 'development') {
                    this.logger.debug(
                      `getFinancialReport: Award ${award.id} (${award.reason.substring(0, 50)}...) 的 reason 中明确说明 ${rfqItem.productName} 已被移除，跳过匹配`,
                    );
                  }
                  return false;
                }
              }
              
              return true;
            });

            if (matchingAward) {
              if (process.env.NODE_ENV === 'development') {
                this.logger.debug(
                  `getFinancialReport: 找到匹配的 Award ${matchingAward.id}，供应商: ${quoteItemCandidate.quote.supplier?.username || quoteItemCandidate.quote.supplierId}, 价格: ¥${quoteItemCandidate.price}`,
                );
              }
              matchedQuoteItems.push({
                quoteItem: quoteItemCandidate,
                price: parseFloat(quoteItemCandidate.price.toString()),
                submittedAt: quoteItemCandidate.quote.submittedAt || quoteItemCandidate.quote.createdAt || null,
                award: matchingAward, // 保存 Award 记录，以便后续获取 paymentQrCodeUrl
              });
            } else if (process.env.NODE_ENV === 'development') {
              // 检查是否因为 reason 被过滤，或者没有匹配的 Award
              const awardForThisQuote = allAwards.find(a => a.quoteId === quoteItemCandidate.quote.id);
              if (awardForThisQuote) {
                if (awardForThisQuote.reason && typeof awardForThisQuote.reason === 'string') {
                  const escapedProductName = rfqItem.productName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                  const removedPattern = new RegExp(`已移除商品[：:][^；;]*?${escapedProductName}`, 'i');
                  if (removedPattern.test(awardForThisQuote.reason)) {
                    this.logger.debug(
                      `getFinancialReport: 供应商 ${quoteItemCandidate.quote.supplier?.username || quoteItemCandidate.quote.supplierId} 的报价项被过滤（reason 中包含已移除商品）`,
                    );
                  } else {
                    // Award 存在，但 quote.items 中可能没有包含该报价项
                    const hasItem = awardForThisQuote.quote.items?.some((qi: any) => 
                      qi.id === quoteItemCandidate.id && qi.rfqItemId === rfqItem.id
                    );
                    if (!hasItem) {
                      this.logger.debug(
                        `getFinancialReport: 供应商 ${quoteItemCandidate.quote.supplier?.username || quoteItemCandidate.quote.supplierId} 的 Award ${awardForThisQuote.id} 存在，但 quote.items 中不包含报价项 ${quoteItemCandidate.id}`,
                      );
                    }
                  }
                }
              } else {
                this.logger.debug(
                  `getFinancialReport: 供应商 ${quoteItemCandidate.quote.supplier?.username || quoteItemCandidate.quote.supplierId} 的报价项没有对应的 Award 记录`,
                );
              }
            }
          }

          // 如果有多个匹配的 Award，选择价格最低的（价格相同时，按提交时间排序）
          let bestMatchedAward: any = null; // 保存最佳匹配的 Award，用于获取 paymentQrCodeUrl
          if (matchedQuoteItems.length > 0) {
            matchedQuoteItems.sort((a, b) => {
              if (a.price !== b.price) {
                return a.price - b.price;
              }
              // 价格相同时，按提交时间排序（最早提交的优先）
              const timeA = a.submittedAt ? new Date(a.submittedAt).getTime() : 0;
              const timeB = b.submittedAt ? new Date(b.submittedAt).getTime() : 0;
              return timeA - timeB;
            });
            bestQuoteItem = matchedQuoteItems[0].quoteItem;
            bestMatchedAward = matchedQuoteItems[0].award; // 保存最佳匹配的 Award
            if (process.env.NODE_ENV === 'development') {
              this.logger.debug(
                `getFinancialReport: 通过 Award 记录找到中标报价项（从 ${matchedQuoteItems.length} 个匹配项中选择价格最低的）: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`,
              );
            }
          }

          // 如果没有找到 Award 记录，考虑一口价的情况
          if (!bestQuoteItem) {
            const instantPrice = rfqItem.instantPrice ? parseFloat(rfqItem.instantPrice.toString()) : null;
            
            if (instantPrice) {
              // 如果有一口价，优先选择满足一口价的报价，按提交时间排序（最早提交的优先）
              const instantPriceQuotes = validQuoteItems
                .filter((item: any) => parseFloat(item.price.toString()) <= instantPrice)
                .sort((a: any, b: any) => {
                  const timeA = a.quote.submittedAt || a.quote.createdAt || new Date(0);
                  const timeB = b.quote.submittedAt || b.quote.createdAt || new Date(0);
                  return new Date(timeA).getTime() - new Date(timeB).getTime();
                });
              
              if (instantPriceQuotes.length > 0) {
                bestQuoteItem = instantPriceQuotes[0];
                if (process.env.NODE_ENV === 'development') {
                  this.logger.debug(
                    `getFinancialReport: 未找到 Award 记录，使用满足一口价且最早提交的报价: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`,
                  );
                }
              }
            }

            // 如果没有满足一口价的，使用价格最低的报价（价格相同，按提交时间排序）
            if (!bestQuoteItem) {
              const sortedQuoteItems = validQuoteItems.sort((a: any, b: any) => {
                const priceA = parseFloat(a.price.toString());
                const priceB = parseFloat(b.price.toString());
                if (priceA !== priceB) {
                  return priceA - priceB;
                }
                const timeA = a.quote.submittedAt || a.quote.createdAt || new Date(0);
                const timeB = b.quote.submittedAt || b.quote.createdAt || new Date(0);
                return new Date(timeA).getTime() - new Date(timeB).getTime();
              });
              bestQuoteItem = sortedQuoteItems[0];
              if (process.env.NODE_ENV === 'development') {
                this.logger.debug(
                  `getFinancialReport: 未找到 Award 记录，使用最低报价: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`,
                );
              }
            }
          }

          // 检查 bestQuoteItem 是否有效
          if (!bestQuoteItem || !bestQuoteItem.quote || !bestQuoteItem.quote.supplier) {
            continue;
          }

          const supplierId = bestQuoteItem.quote.supplierId;
          const supplierName = bestQuoteItem.quote.supplier.username || '未知供应商';

          // 记录所有报价，用于调试（仅在开发环境）
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug(
              `商品 ${rfqItem.id} (${rfqItem.productName}) 共有 ${validQuoteItems.length} 个有效报价`,
            );
            this.logger.debug(
              `商品 ${rfqItem.id} (${rfqItem.productName}) 中标供应商 ${supplierName} (${supplierId}), 价格: ¥${bestQuoteItem.price}`,
            );
          }

          // 标记该商品已被处理
          processedRfqItems.add(rfqItem.id);

          // 获取门店ID（RFQ的门店ID）
          const rfqStoreId = rfq.storeId || '';
          
          // 创建 RFQ+供应商+门店 的唯一key
          const groupKey = `${rfq.id}-${supplierId}-${rfqStoreId}`;
          
          if (!supplierPayments[supplierId]) {
            supplierPayments[supplierId] = {
              supplierId,
              supplierName,
              totalAmount: 0,
              awardCount: 0,
              rfqGroups: [],
            };
          }

          // 找到该供应商在该RFQ下的所有发货单（只统计该门店的）
          const shipments = rfqItem.shipments?.filter(s => s.supplierId === supplierId) || [];
          const shipmentIds = shipments.map(s => s.id);
          
          // 查找是否有结算记录（检查所有发货单的结算记录）
          let settlementId: string | undefined;
          let hasPaymentScreenshot = false;
          let paymentScreenshotUrl: string | undefined;
          for (const shipment of shipments) {
            const settlement = shipment.settlements?.[0];
            if (settlement) {
              if (!settlementId) {
                settlementId = settlement.id; // 记录第一个结算记录ID
              }
              if (settlement.qrCodeUrl) {
                hasPaymentScreenshot = true;
                if (!paymentScreenshotUrl) {
                  // 获取付款截图的完整URL
                  try {
                    const fileKey = settlement.qrCodeUrl;
                    paymentScreenshotUrl = await this.storageService.getFileUrl(fileKey);
                  } catch (urlError) {
                    // 如果获取URL失败，使用原始值
                    paymentScreenshotUrl = settlement.qrCodeUrl;
                  }
                }
              }
            }
          }
          
          const itemPrice = Number(bestQuoteItem.price) * (rfqItem.quantity || 1);
          supplierPayments[supplierId].totalAmount += itemPrice;
          
          // 查找或创建该 RFQ+供应商+门店 的分组
          let rfqGroup = supplierPayments[supplierId].rfqGroups.find(
            g => g.rfqId === rfq.id && g.storeId === rfqStoreId,
          );
          
          // 获取收款二维码URL（从匹配的 Award 中获取）
          let paymentQrCodeUrl: string | undefined = undefined;
          if (bestMatchedAward && bestMatchedAward.paymentQrCodeUrl) {
            try {
              // 如果存储的是文件 key，生成签名 URL
              const fileKey = bestMatchedAward.paymentQrCodeUrl;
              paymentQrCodeUrl = await this.storageService.getFileUrl(fileKey, 7 * 24 * 3600); // 7天有效期
            } catch (urlError) {
              // 如果获取URL失败，使用原始值（可能是完整的URL）
              paymentQrCodeUrl = bestMatchedAward.paymentQrCodeUrl;
            }
          }
          
          if (!rfqGroup) {
            rfqGroup = {
              rfqId: rfq.id,
              rfqNo: rfq.rfqNo,
              rfqTitle: rfq.title,
              totalAmount: 0,
              storeId: rfqStoreId || undefined,
              storeName: rfq.store?.name || undefined,
              storeCode: rfq.store?.code || undefined,
              shipmentIds: [],
              settlementId: undefined,
              hasPaymentScreenshot: false,
              paymentScreenshotUrl: undefined,
              paymentQrCodeUrl: paymentQrCodeUrl, // 供应商上传的收款二维码
              items: [],
            };
            supplierPayments[supplierId].rfqGroups.push(rfqGroup);
          } else {
            // 如果 rfqGroup 已存在但没有收款二维码，更新它
            if (!rfqGroup.paymentQrCodeUrl && paymentQrCodeUrl) {
              rfqGroup.paymentQrCodeUrl = paymentQrCodeUrl;
            }
          }
          
          // 更新RFQ分组信息
          rfqGroup.totalAmount += itemPrice;
          rfqGroup.items.push({
            rfqItemId: rfqItem.id,
            productName: rfqItem.productName,
            quantity: rfqItem.quantity || 1,
            price: itemPrice,
            trackingNo: shipments[0]?.trackingNo || undefined,
            carrier: shipments[0]?.carrier || undefined,
            shipmentId: shipments[0]?.id || undefined,
          });
          
          // 合并发货单ID到RFQ分组（去重）
          shipmentIds.forEach(id => {
            if (!rfqGroup!.shipmentIds.includes(id)) {
              rfqGroup!.shipmentIds.push(id);
            }
          });
          
          // 更新结算状态（如果找到新的结算记录）
          if (settlementId && !rfqGroup.settlementId) {
            rfqGroup.settlementId = settlementId;
          }
          if (hasPaymentScreenshot) {
            rfqGroup.hasPaymentScreenshot = true;
          }
          if (paymentScreenshotUrl && !rfqGroup.paymentScreenshotUrl) {
            rfqGroup.paymentScreenshotUrl = paymentScreenshotUrl;
          }
        }
      }

      // 统计每个供应商的中标商品数量（按询价单分组，而不是按商品）
      // 包括RFQ中标和库存采购订单
      Object.values(supplierPayments).forEach(supplier => {
        const rfqNos = new Set(supplier.rfqGroups.map(group => group.rfqNo));
        supplier.awardCount = rfqNos.size;
      });

      // 查询电商平台采购（只统计填写了物流单号的商品）
      const ecommerceWhere: any = {
        source: 'ECOMMERCE',
        trackingNo: {
          not: null,
        },
        updatedAt: {
          gte: startTime,
          lte: endTime,
        },
      };

      // 如果指定了门店，添加门店筛选（通过关联的RFQ）
      if (storeId && storeId.trim() !== '') {
        ecommerceWhere.rfq = {
          storeId: storeId.trim(),
        };
        this.logger.debug(
          `getFinancialReport: 电商采购添加门店筛选条件，storeId: ${storeId.trim()}`,
        );
      }

      const ecommerceItems = await this.prisma.rfqItem.findMany({
        where: ecommerceWhere,
        include: {
          rfq: {
            select: {
              rfqNo: true,
              storeId: true,
              store: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
            },
          },
        },
      });

      let ecommerceTotal = 0;
      ecommerceItems.forEach(item => {
        if (item.costPrice) {
          ecommerceTotal += Number(item.costPrice) * (item.quantity || 1);
        }
      });

      // 构建电商平台采购明细（询价单中的电商采购）
      const ecommerceItemsList = ecommerceItems.map(item => ({
        rfqNo: item.rfq.rfqNo,
        rfqItemId: item.id,
        productName: item.productName,
        quantity: item.quantity || 1,
        price: Number(item.costPrice || 0) * (item.quantity || 1),
        trackingNo: item.trackingNo || undefined,
        carrier: item.carrier || undefined,
        storeId: item.rfq.storeId || undefined,
        storeName: item.rfq.store?.name || undefined,
        storeCode: item.rfq.store?.code || undefined,
      }));

      // 添加从库存下单的订单数据（source: 'ECOMMERCE'）
      const inventoryOrdersWhere: any = {
        source: 'ECOMMERCE', // 从库存下单的订单
        orderTime: {
          gte: startTime,
          lte: endTime,
        },
      };

      // 如果指定了门店，添加门店筛选
      if (storeId && storeId.trim() !== '') {
        inventoryOrdersWhere.storeId = storeId.trim();
        this.logger.debug(
          `getFinancialReport: 库存订单添加门店筛选条件，storeId: ${storeId.trim()}`,
        );
      }

      const inventoryOrders = await this.prisma.order.findMany({
        where: inventoryOrdersWhere,
        include: {
          store: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          shipments: {
            where: {
              source: 'ECOMMERCE', // 从库存下单的发货单
            },
            include: {
              supplier: {
                select: {
                  id: true,
                  username: true,
                },
              },
              settlements: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
        },
      });

      // 将库存订单添加到供应商付款明细中（而不是电商采购）
      // 并行处理所有订单的付款截图URL获取
      await Promise.all(
        inventoryOrders.map(async (order) => {
          const shipment = order.shipments?.[0]; // 通常只有一个发货单
          if (!shipment || !shipment.supplierId) {
            // 如果没有发货单或供应商信息，跳过
            return;
          }

          const supplierId = shipment.supplierId;
          const supplierName = shipment.supplier?.username || '未知供应商';
          const orderPrice = Number(order.price) || 0;
          const orderStoreId = order.storeId || '';

          // 查找或创建供应商付款记录
          if (!supplierPayments[supplierId]) {
            supplierPayments[supplierId] = {
              supplierId,
              supplierName,
              totalAmount: 0,
              awardCount: 0,
              rfqGroups: [],
            };
          }

          supplierPayments[supplierId].totalAmount += orderPrice;

          // 查找结算记录
          const settlement = shipment.settlements?.[0];
          let settlementId: string | undefined;
          let hasPaymentScreenshot = false;
          let paymentScreenshotUrl: string | undefined;

          if (settlement) {
            settlementId = settlement.id;
            if (settlement.qrCodeUrl) {
              hasPaymentScreenshot = true;
              try {
                const fileKey = settlement.qrCodeUrl;
                paymentScreenshotUrl = await this.storageService.getFileUrl(fileKey);
              } catch (urlError) {
                paymentScreenshotUrl = settlement.qrCodeUrl;
              }
            }
          }

          // 创建虚拟RFQ分组（库存订单没有RFQ，使用订单号作为标识）
          const virtualRfqId = `inventory-${order.id}`;
          const virtualRfqNo = `INV-${order.orderNo}`;

          let rfqGroup = supplierPayments[supplierId].rfqGroups.find(
            g => g.rfqId === virtualRfqId && g.storeId === orderStoreId,
          );

          if (!rfqGroup) {
            rfqGroup = {
              rfqId: virtualRfqId,
              rfqNo: virtualRfqNo,
              rfqTitle: '供应商库存采购',
              totalAmount: 0,
              storeId: orderStoreId || undefined,
              storeName: order.store?.name || undefined,
              storeCode: order.store?.code || undefined,
              shipmentIds: [shipment.id],
              settlementId: settlementId,
              hasPaymentScreenshot: hasPaymentScreenshot,
              paymentScreenshotUrl: paymentScreenshotUrl,
              items: [],
            };
            supplierPayments[supplierId].rfqGroups.push(rfqGroup);
          }

          // 更新RFQ分组信息
          rfqGroup.totalAmount += orderPrice;
          rfqGroup.items.push({
            rfqItemId: `inventory-order-${order.id}`,
            productName: order.productName || '未知商品',
            quantity: 1,
            price: orderPrice,
            trackingNo: shipment.trackingNo || undefined,
            carrier: shipment.carrier || undefined,
            shipmentId: shipment.id,
          });

          // 更新结算状态
          if (settlementId && !rfqGroup.settlementId) {
            rfqGroup.settlementId = settlementId;
          }
          if (hasPaymentScreenshot) {
            rfqGroup.hasPaymentScreenshot = true;
          }
          if (paymentScreenshotUrl && !rfqGroup.paymentScreenshotUrl) {
            rfqGroup.paymentScreenshotUrl = paymentScreenshotUrl;
          }
        }),
      );

      // 统计应付款、待付款和已付款
      let payableCount = 0; // 应付款：已中标但供应商还没有上传快递单号
      let payableAmount = 0;
      let pendingPaymentCount = 0; // 待付款：供应商已上传快递单号但没有付款截图
      let pendingPaymentAmount = 0;
      let paidCount = 0; // 已付款：有付款截图
      let paidAmount = 0;

      Object.values(supplierPayments).forEach(supplier => {
        supplier.rfqGroups.forEach(rfqGroup => {
          // 检查是否有发货单（有trackingNo表示供应商已上传快递单号）
          const hasTrackingNo = rfqGroup.items.some(item => item.trackingNo);
          
          if (hasTrackingNo) {
            if (rfqGroup.hasPaymentScreenshot) {
              // 已付款：有付款截图
              paidCount++;
              paidAmount += rfqGroup.totalAmount;
            } else {
              // 待付款：有快递单号但没有付款截图
              pendingPaymentCount++;
              pendingPaymentAmount += rfqGroup.totalAmount;
            }
          } else {
            // 应付款：已中标但供应商还没有上传快递单号
            payableCount++;
            payableAmount += rfqGroup.totalAmount;
          }
        });
      });

      const supplierTotal = Object.values(supplierPayments).reduce(
        (sum, s) => sum + s.totalAmount,
        0,
      );

      const result = {
        date: targetDate.toISOString().split('T')[0],
        period: period,
        periodLabel: periodLabel,
        startDate: startTime.toISOString().split('T')[0],
        endDate: endTime.toISOString().split('T')[0],
        suppliers: Object.values(supplierPayments),
        ecommerce: {
          itemCount: ecommerceItemsList.length, // 只包含询价单中的电商平台采购（拼多多/淘宝等）
          totalAmount: ecommerceTotal,
          items: ecommerceItemsList,
        },
        summary: {
          supplierTotal,
          supplierCount: Object.keys(supplierPayments).length,
          ecommerceTotal,
          totalAmount: supplierTotal + ecommerceTotal,
          payable: {
            count: payableCount,
            amount: payableAmount,
          },
          pendingPayment: {
            count: pendingPaymentCount,
            amount: pendingPaymentAmount,
          },
          paid: {
            count: paidCount,
            amount: paidAmount,
          },
        },
      };
      
      // 缓存结果
      try {
        await this.redisClient.setex(cacheKey, cacheTTL, JSON.stringify(result));
        this.logger.debug(`getFinancialReport: 数据已缓存，key: ${cacheKey}, TTL: ${cacheTTL}秒`);
      } catch (cacheError) {
        this.logger.warn(`getFinancialReport: 缓存写入失败`, cacheError);
      }
      
      // 调试日志：检查返回的数据中是否包含门店信息
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(
          `getFinancialReport: 返回结果统计 - 供应商数量 ${result.suppliers.length}, 电商采购项 ${result.ecommerce.itemCount}`,
        );
        if (result.suppliers.length > 0 && result.suppliers[0].rfqGroups.length > 0) {
          const firstRfqGroup = result.suppliers[0].rfqGroups[0];
          this.logger.debug(
            `getFinancialReport: 第一个供应商的第一个RFQ分组门店信息: storeId=${firstRfqGroup.storeId}, storeName=${firstRfqGroup.storeName}, storeCode=${firstRfqGroup.storeCode}`,
          );
        }
      }
      
      return result;
    } catch (error: any) {
      this.logger.error('getFinancialReport 错误', error.stack || error.message);
      throw error;
    }
  }
}
