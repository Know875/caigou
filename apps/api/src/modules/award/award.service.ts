import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationQueue } from '../../queues/notification.queue';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class AwardService {
  private readonly logger = new Logger(AwardService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private auditService: AuditService,
    private notificationQueue: NotificationQueue,
    private notificationService: NotificationService,
  ) {}

  async findOne(id: string) {
    const award = await this.prisma.award.findUnique({
      where: { id },
      include: {
        rfq: {
          include: {
            items: true,
          },
        },
        quote: {
          include: {
        items: {
          include: {
            rfqItem: {
              include: {
                order: {
                  // 直接通过 orderNo 关联的订单（推荐方式）
                  select: {
                    id: true,
                    orderNo: true,
                    orderTime: true,
                    userNickname: true,
                    openid: true,
                    recipient: true,
                    phone: true,
                    address: true,
                    modifiedAddress: true,
                    productName: true,
                    price: true,
                    points: true,
                    status: true,
                    shippedAt: true,
                    storeId: true,
                    store: {
                      select: {
                        name: true,
                      },
                    },
                  },
                } as any, // Type assertion for now, will be fixed after prisma generate
              } as any, // Type assertion for rfqItem include
            } as any, // Type assertion for quoteItem include
          },
        },
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        shipments: true,
      },
    });

    if (!award) {
      throw new NotFoundException('Award not found');
    }

    return award;
  }

  /**
   * 采购员/门店用户查看中标订单（包含物流信息）
   * @param buyerId 采购员ID（可选）
   * @param requestOrigin 请求来源（用于生成 MinIO 签名 URL）
   * @param storeId 门店ID（可选，门店用户必须提供）
   */
  async findByBuyer(buyerId?: string, requestOrigin?: string, storeId?: string) {
    // 由于每个商品独立中标，我们需要查询所有已中标的商品
    // 通过 RfqItem 的状态为 AWARDED 来查找，然后找到每个商品的中标供应商
    
    this.logger.debug(`findByBuyer: 开始查询，buyerId: ${buyerId || '所有'}, storeId: ${storeId || '所有'}`);
    
    // 构建查询条件
    const whereCondition: any = {
      itemStatus: 'AWARDED',
    };
    
    // 门店用户只能看到自己门店的询价单的中标商品
    if (storeId) {
      whereCondition.rfq = {
        storeId: storeId,
      };
    }
    
    // 优化：批量查询所有已中标商品的报价，避免 N+1 查询
    // 先查询所有已中标的 RFQ 商品
    const awardedRfqItems = await this.prisma.rfqItem.findMany({
      where: whereCondition,
      include: {
        rfq: {
          include: {
            orders: {
              include: {
                order: true,
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
        },
        // ⚠️ 管理员和采购员权限：直接通过 orderNo 关联获取订单信息（推荐方式）
        order: {
          select: {
            id: true,
            orderNo: true,
            orderTime: true,
            userNickname: true,
            openid: true,
            recipient: true,
            phone: true,
            address: true,
            modifiedAddress: true,
            productName: true,
            price: true,
            points: true,
            status: true,
            shippedAt: true,
            storeId: true,
            store: {
              select: {
                name: true,
              },
            },
          },
        } as any, // Type assertion for now, will be fixed after prisma generate
        shipments: {
          include: {
            packages: true,
            supplier: {
              select: {
                id: true,
                username: true,
                email: true,
              },
            },
            afterSalesReplacement: {
              select: {
                id: true,
                caseNo: true,
              },
            },
          },
          // 确保按更新时间排序，获取最新的运单号
          orderBy: {
            updatedAt: 'desc',
          },
        },
        quoteItems: {
          include: {
            rfqItem: true, // 包含 rfqItem，以便前端能正确匹配
            quote: {
              include: {
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
      } as any, // Type assertion for RfqItem include
      orderBy: {
        updatedAt: 'desc',
      },
    });

    this.logger.debug(`findByBuyer: 查询到 ${awardedRfqItems.length} 个已中标的 RFQ 商品`);
    
    // 记录每个商品的 shipments 信息（仅在调试模式）
    if (process.env.NODE_ENV === 'development') {
      awardedRfqItems.forEach((item) => {
        this.logger.debug(`findByBuyer: RFQ商品 ${item.id} (${item.productName}) 有 ${item.shipments?.length || 0} 个发货单`);
        item.shipments?.forEach((shipment: any) => {
          this.logger.debug(`findByBuyer: 发货单 ${shipment.id}, trackingNo: ${shipment.trackingNo || '(空)'}, carrier: ${shipment.carrier || '(空)'}`);
        });
      });
    }

    // 为每个商品找到中标供应商（价格最低的报价）
    const itemAwards: Array<{
      rfqItem: any;
      quoteItem: any;
      quote: any;
      supplier: any;
      price: number;
    }> = [];

    for (const rfqItem of awardedRfqItems) {
      const rfqItemWithRelations = rfqItem as any; // Type assertion
      this.logger.debug(`findByBuyer: 处理商品 ${rfqItem.id} (${rfqItem.productName})，初始查询有 ${rfqItemWithRelations.quoteItems?.length || 0} 个报价`);
      
      // 重新查询所有报价，确保获取完整数据（避免查询时遗漏）
      const allQuoteItems = await this.prisma.quoteItem.findMany({
        where: { rfqItemId: rfqItem.id },
        include: {
          quote: {
            include: {
              supplier: {
                select: {
                  id: true,
                  username: true,
                  email: true,
                },
              },
            },
          },
          rfqItem: true,
        },
      });
      
      this.logger.debug(`findByBuyer: 重新查询后，商品 ${rfqItem.id} 有 ${allQuoteItems.length} 个报价`);
      
      if (allQuoteItems.length === 0) {
        this.logger.warn(`findByBuyer: 商品 ${rfqItem.id} (${rfqItem.productName}) 没有报价，跳过`);
        continue;
      }

      // 打印所有报价用于调试（仅在开发模式）
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`findByBuyer: 商品 ${rfqItem.id} 的所有报价`, allQuoteItems.map((qi: any) => ({
          quoteItemId: qi.id,
          supplierId: qi.quote.supplier.id,
          supplierName: qi.quote.supplier.username,
          price: qi.price,
          quoteId: qi.quote.id,
        })));
      }

      // 优先查找 Award 记录，确定中标供应商（支持手动选商）
      // 查询该询价单的所有 Award 记录
      const awards = await this.prisma.award.findMany({
        where: {
          rfqId: rfqItem.rfqId,
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

      let bestQuoteItem: any = null;

      // 查找该商品的中标报价项（通过 Award 记录）
      // ⚠️ 重要：必须确保找到的报价项确实是该商品的中标报价项
      // ⚠️ 如果多个 Award 记录都包含该商品的 quoteItem，选择价格最低的（或最早提交的）
      const candidateQuoteItems: Array<{ award: any; quoteItem: any; price: number; submittedAt: Date }> = [];
      
      for (const award of awards) {
        // 如果该 Award 对应的报价中有该商品的报价项，说明该供应商中标了
        if (award.quote.items && award.quote.items.length > 0) {
          // ⚠️ 重要：验证该报价项确实对应当前商品（rfqItemId匹配）
          const awardedQuoteItem = award.quote.items.find(qi => qi.rfqItemId === rfqItem.id);
          if (awardedQuoteItem) {
            // 验证该报价项确实存在于 allQuoteItems 中
            const matchingQuoteItem = allQuoteItems.find(qi => qi.id === awardedQuoteItem.id);
            if (matchingQuoteItem) {
              candidateQuoteItems.push({
                award,
                quoteItem: matchingQuoteItem,
                price: parseFloat(matchingQuoteItem.price.toString()),
                submittedAt: matchingQuoteItem.quote.submittedAt || matchingQuoteItem.quote.createdAt,
              });
            }
          }
        }
      }
      
      // 如果有多个候选，优先选择满足一口价的（如果有一口价），然后选择价格最低的（如果价格相同，选择最早提交的）
      if (candidateQuoteItems.length > 0) {
        const instantPrice = rfqItem.instantPrice ? parseFloat(rfqItem.instantPrice.toString()) : null;
        
        // 如果有一口价，优先选择满足一口价的报价
        if (instantPrice) {
          const instantPriceCandidates = candidateQuoteItems.filter(
            item => item.price <= instantPrice
          );
          
          if (instantPriceCandidates.length > 0) {
            // 在满足一口价的候选中，按提交时间排序（最早提交的优先）
            instantPriceCandidates.sort((a, b) => {
              return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
            });
            bestQuoteItem = instantPriceCandidates[0].quoteItem;
            this.logger.debug(`findByBuyer: 通过 Award 记录找到中标供应商（满足一口价）: ${bestQuoteItem.quote.supplier.username} (${bestQuoteItem.quote.supplier.id})，价格: ¥${bestQuoteItem.price}，商品: ${rfqItem.productName}，一口价: ¥${instantPrice}`);
          } else {
            // 没有满足一口价的，按价格排序
            candidateQuoteItems.sort((a, b) => {
              if (a.price !== b.price) {
                return a.price - b.price; // 价格优先
              }
              // 价格相同，按提交时间排序（最早提交的优先）
              return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
            });
            bestQuoteItem = candidateQuoteItems[0].quoteItem;
            this.logger.warn(`findByBuyer: 通过 Award 记录找到中标供应商（但不满足一口价）: ${bestQuoteItem.quote.supplier.username} (${bestQuoteItem.quote.supplier.id})，价格: ¥${bestQuoteItem.price}，商品: ${rfqItem.productName}，一口价: ¥${instantPrice}，候选数: ${candidateQuoteItems.length}`);
          }
        } else {
          // 没有一口价，按价格排序
          candidateQuoteItems.sort((a, b) => {
            if (a.price !== b.price) {
              return a.price - b.price; // 价格优先
            }
            // 价格相同，按提交时间排序（最早提交的优先）
            return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
          });
          
          bestQuoteItem = candidateQuoteItems[0].quoteItem;
          this.logger.debug(`findByBuyer: 通过 Award 记录找到中标供应商: ${bestQuoteItem.quote.supplier.username} (${bestQuoteItem.quote.supplier.id})，价格: ¥${bestQuoteItem.price}，商品: ${rfqItem.productName}，候选数: ${candidateQuoteItems.length}`);
        }
      }

      // 如果没有找到 Award 记录，优先选择满足一口价的报价（如果有一口价），否则使用价格最低的报价项（自动选商）
      if (!bestQuoteItem) {
        const instantPrice = rfqItem.instantPrice ? parseFloat(rfqItem.instantPrice.toString()) : null;
        
        if (instantPrice) {
          // 如果有一口价，优先选择满足一口价的报价，按提交时间排序（最早提交的优先）
          const instantPriceQuotes = allQuoteItems
            .filter((item: any) => parseFloat(item.price.toString()) <= instantPrice)
            .sort((a: any, b: any) => {
              const timeA = a.quote?.submittedAt || a.createdAt || new Date(0);
              const timeB = b.quote?.submittedAt || b.createdAt || new Date(0);
              return new Date(timeA).getTime() - new Date(timeB).getTime();
            });
          
          if (instantPriceQuotes.length > 0) {
            bestQuoteItem = instantPriceQuotes[0];
            this.logger.debug(`findByBuyer: 未找到 Award 记录，使用满足一口价且最早提交的报价: ${bestQuoteItem.quote.supplier.username} (${bestQuoteItem.quote.supplier.id})，价格: ¥${bestQuoteItem.price}，一口价: ¥${instantPrice}`);
          } else {
            // 没有满足一口价的，使用价格最低的
            const sortedQuoteItems = allQuoteItems.sort((a, b) => {
              const priceA = parseFloat(a.price.toString());
              const priceB = parseFloat(b.price.toString());
              return priceA - priceB;
            });
            bestQuoteItem = sortedQuoteItems[0];
            this.logger.debug(`findByBuyer: 未找到 Award 记录，且没有满足一口价的报价，使用最低报价: ${bestQuoteItem.quote.supplier.username} (${bestQuoteItem.quote.supplier.id})，价格: ¥${bestQuoteItem.price}，一口价: ¥${instantPrice}`);
          }
        } else {
          // 没有一口价，使用价格最低的
          const sortedQuoteItems = allQuoteItems.sort((a, b) => {
            const priceA = parseFloat(a.price.toString());
            const priceB = parseFloat(b.price.toString());
            return priceA - priceB;
          });
          bestQuoteItem = sortedQuoteItems[0];
          this.logger.debug(`findByBuyer: 未找到 Award 记录，使用最低报价: ${bestQuoteItem.quote.supplier.username} (${bestQuoteItem.quote.supplier.id})，价格: ¥${bestQuoteItem.price}`);
        }
      }

      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`findByBuyer: 商品 ${rfqItem.id} (${rfqItem.productName}) 最终中标供应商: ${bestQuoteItem.quote.supplier.username} (${bestQuoteItem.quote.supplier.id})，价格: ¥${bestQuoteItem.price}`);
      }

      itemAwards.push({
        rfqItem,
        quoteItem: bestQuoteItem,
        quote: bestQuoteItem.quote,
        supplier: bestQuoteItem.quote.supplier,
        price: parseFloat(bestQuoteItem.price.toString()),
      });
    }

    // 按 RFQ 和供应商分组，创建虚拟 Award 对象
    const rfqSupplierGroups = new Map<string, Map<string, typeof itemAwards>>();
    for (const itemAward of itemAwards) {
      const rfqId = itemAward.rfqItem.rfqId;
      const supplierId = itemAward.supplier.id;
      
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`findByBuyer: 分组商品 - RFQ: ${rfqId}, 供应商: ${supplierId}, 商品: ${itemAward.rfqItem.productName}, 报价ID: ${itemAward.quote.id}`);
      }
      
      if (!rfqSupplierGroups.has(rfqId)) {
        rfqSupplierGroups.set(rfqId, new Map());
      }
      const supplierMap = rfqSupplierGroups.get(rfqId)!;
      
      if (!supplierMap.has(supplierId)) {
        supplierMap.set(supplierId, []);
      }
      supplierMap.get(supplierId)!.push(itemAward);
    }
    
    // 打印分组结果用于调试（仅在开发模式）
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(`findByBuyer: 分组完成，共 ${rfqSupplierGroups.size} 个 RFQ`);
      for (const [rfqId, supplierMap] of rfqSupplierGroups) {
        this.logger.debug(`findByBuyer: RFQ ${rfqId} 有 ${supplierMap.size} 个供应商`);
        for (const [supplierId, items] of supplierMap) {
          this.logger.debug(`findByBuyer: 供应商 ${supplierId} 有 ${items.length} 个商品: ${items.map(i => i.rfqItem.productName).join(', ')}`);
        }
      }
    }

    // 为每个 RFQ-供应商组合创建虚拟 Award 对象
    const virtualAwards: any[] = [];
    for (const [rfqId, supplierMap] of rfqSupplierGroups) {
      for (const [supplierId, items] of supplierMap) {
        const firstItem = items[0];
        const totalPrice = items.reduce((sum, item) => sum + item.price, 0);
        
        // 验证所有商品都属于同一个供应商（安全检查）
        const allSameSupplier = items.every(item => item.supplier.id === supplierId);
        if (!allSameSupplier) {
          this.logger.error(`findByBuyer: 错误！供应商 ${supplierId} 的分组中包含其他供应商的商品！`, items.map(item => ({
            productName: item.rfqItem.productName,
            supplierId: item.supplier.id,
            supplierName: item.supplier.username,
          })));
          // 跳过这个分组，避免数据错误
          continue;
        }
        
        // 验证所有商品都属于同一个 RFQ（安全检查）
        const allSameRfq = items.every(item => item.rfqItem.rfqId === rfqId);
        if (!allSameRfq) {
          this.logger.error(`findByBuyer: 错误！RFQ ${rfqId} 的分组中包含其他 RFQ 的商品！`, items.map(item => ({
            productName: item.rfqItem.productName,
            rfqId: item.rfqItem.rfqId,
          })));
          // 跳过这个分组，避免数据错误
          continue;
        }
        
        this.logger.debug(`findByBuyer: 创建虚拟 Award - RFQ: ${rfqId}, 供应商: ${supplierId} (${firstItem.supplier.username}), 商品数量: ${items.length}`);
        
        // 查找真实的 Award 记录（如果有），以获取 paymentQrCodeUrl
        let realAward = null;
        try {
          realAward = await this.prisma.award.findUnique({
            where: {
              rfqId_supplierId: {
                rfqId,
                supplierId,
              },
            },
            select: {
              paymentQrCodeUrl: true,
              updatedAt: true,
            },
          });
          if (realAward) {
            if (process.env.NODE_ENV === 'development') {
              this.logger.debug(`findByBuyer: 找到真实的 Award 记录，paymentQrCodeUrl: ${realAward.paymentQrCodeUrl || '(空)'}`);
            }
          }
        } catch (error: any) {
          this.logger.warn(`findByBuyer: 查找真实 Award 记录时出错`, error.message);
        }
        
        // 收集所有 shipments（包含 trackingNo 和 carrier）
        // 确保每个 shipment 都有正确的 rfqItemId，以便前端能正确匹配
        const allShipments = items.flatMap(item => {
          const shipments = item.rfqItem.shipments || [];
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug(`findByBuyer: RFQ商品 ${item.rfqItem.id} (${item.rfqItem.productName}) 有 ${shipments.length} 个发货单`);
          }
          return shipments.map((shipment: any) => {
            // 确保 shipment 有正确的 rfqItemId
            if (!shipment.rfqItemId) {
              shipment.rfqItemId = item.rfqItem.id;
            }
            return shipment;
          });
        });
        
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`findByBuyer: 创建虚拟 Award ${rfqId}-${supplierId}，共 ${allShipments.length} 个发货单`);
        }
        
        // ⚠️ 重要：确保quote.items只包含真正中标的商品
        // 不要使用firstItem.quote.items，因为那个quote可能包含未中标的商品
        // 只使用当前分组中真正中标的商品
        const awardedQuoteItems = items.map(item => ({
          ...item.quoteItem,
          rfqItem: item.rfqItem, // 确保包含 rfqItem，以便前端能正确匹配
        }));
        
        // 创建一个新的quote对象，只包含真正中标的商品
        const awardedQuote = {
          ...firstItem.quote,
          items: awardedQuoteItems, // 只包含真正中标的商品
          // ⚠️ 重要：重新计算quote.price，只包含真正中标的商品
          price: totalPrice.toString(),
        };
        
        virtualAwards.push({
          id: `virtual-${rfqId}-${supplierId}`,
          rfqId,
          quoteId: firstItem.quote.id, // 使用第一个商品的quoteId（用于关联）
          supplierId,
          finalPrice: totalPrice,
          reason: `自动选商：按商品级别最优报价，共 ${items.length} 个商品中标`,
          awardedAt: firstItem.rfqItem.rfq.closeTime || firstItem.rfqItem.rfq.updatedAt,
          createdAt: firstItem.rfqItem.rfq.updatedAt,
          updatedAt: realAward?.updatedAt || firstItem.rfqItem.rfq.updatedAt,
          paymentQrCode: null,
          paymentQrCodeUrl: realAward?.paymentQrCodeUrl || null,
          cancellationReason: null,
          cancelledAt: null,
          cancelledBy: null,
          status: 'ACTIVE',
          rfq: firstItem.rfqItem.rfq,
          quote: awardedQuote, // 使用只包含真正中标商品的quote
          supplier: firstItem.supplier,
          shipments: allShipments,
        });
      }
    }
    
    this.logger.debug(`findByBuyer: 最终创建了 ${virtualAwards.length} 个虚拟 Award 对象`);

    // 按中标时间排序
    virtualAwards.sort((a, b) => {
      const timeA = new Date(a.awardedAt).getTime();
      const timeB = new Date(b.awardedAt).getTime();
      return timeB - timeA;
    });

    const awards = virtualAwards;

    // 转换文件 URL 并匹配订单信息
    // ⚠️ 管理员和采购员权限：可以看到所有订单信息（无限制）
    return Promise.all(awards.map(async (award) => {
      // 为每个 quoteItem 匹配订单信息
      // 优化：直接使用 rfqItem.order 获取订单信息，不再需要通过 rfq.orders 匹配
      const quoteItemsWithOrder = await Promise.all(
        award.quote.items.map(async (quoteItem) => {
          const rfqItem = quoteItem.rfqItem;
          if (!rfqItem) {
            return quoteItem;
          }

          // ⚠️ 管理员和采购员权限：直接使用 rfqItem.order 获取订单信息
          // 这是最直接、最准确的方式，管理员可以看到所有订单信息
          const order = (rfqItem as any).order;

          // 如果找到了订单，返回完整订单信息（管理员和采购员可以看到所有信息）
          if (order) {
            return {
              ...quoteItem,
              rfqItem: {
                ...rfqItem,
                orderInfo: {
                  orderNo: order.orderNo,
                  recipient: order.recipient,
                  phone: order.phone,
                  address: order.modifiedAddress || order.address, // 优先使用修改后的地址
                  modifiedAddress: order.modifiedAddress,
                  userNickname: order.userNickname,
                  openid: order.openid,
                  orderTime: order.orderTime,
                },
              },
            };
          } else {
            // 如果没有直接关联的订单，尝试从 rfq.orders 中查找（向后兼容）
            const matchedOrder = award.rfq.orders?.find(
              (or: any) => or.order.orderNo === rfqItem.orderNo
            )?.order;

            return {
              ...quoteItem,
              rfqItem: {
                ...rfqItem,
                orderInfo: matchedOrder ? {
                  orderNo: matchedOrder.orderNo,
                  recipient: matchedOrder.recipient,
                  phone: matchedOrder.phone,
                  address: matchedOrder.modifiedAddress || matchedOrder.address,
                  modifiedAddress: matchedOrder.modifiedAddress,
                  userNickname: matchedOrder.userNickname,
                  openid: matchedOrder.openid,
                  orderTime: matchedOrder.orderTime,
                } : null,
              },
            };
          }
        })
      );

      // 转换发货照片 URL
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('开始转换发货照片 URL', {
          awardId: award.id,
          shipmentsCount: award.shipments?.length || 0,
        });
      }
      const shipmentsWithUrls = await Promise.all(
        (award.shipments || []).map(async (shipment: any) => {
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug('处理发货单', {
              shipmentId: shipment.id,
              packagesCount: shipment.packages?.length || 0,
            });
          }
          if (shipment.packages && shipment.packages.length > 0) {
            const packagesWithUrls = await Promise.all(
              shipment.packages.map(async (pkg: any) => {
                if (process.env.NODE_ENV === 'development') {
                  this.logger.debug('处理包裹', {
                    packageId: pkg.id,
                    photosCount: Array.isArray(pkg.photos) ? (pkg.photos as string[]).length : 0,
                  });
                }
                const photosArray = Array.isArray(pkg.photos) ? (pkg.photos as string[]) : [];
                if (photosArray.length > 0) {
                  const photoUrls = await Promise.all(
                    photosArray.map(async (photoKey: string) => {
                      const url = await this.storageService.getFileUrl(photoKey, 3600, requestOrigin);
                      if (process.env.NODE_ENV === 'development') {
                        this.logger.debug('照片转换', { photoKey, url });
                      }
                      return url;
                    })
                  );
                  if (process.env.NODE_ENV === 'development') {
                    this.logger.debug('包裹转换完成', {
                      packageId: pkg.id,
                      urlsCount: photoUrls.length,
                    });
                  }
                  return {
                    ...pkg,
                    photos: photoUrls, // 转换为 URL 数组
                  };
                }
                // 如果没有照片，确保返回空数组而不是 undefined
                return {
                  ...pkg,
                  photos: [],
                };
              })
            );
            if (process.env.NODE_ENV === 'development') {
              this.logger.debug('发货单转换完成', {
                shipmentId: shipment.id,
                packagesCount: packagesWithUrls.length,
              });
            }
            return {
              ...shipment,
              packages: packagesWithUrls,
            };
          }
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug('发货单没有包裹', { shipmentId: shipment.id });
          }
          // 即使没有包裹，也确保返回 packages 字段（空数组）
          return {
            ...shipment,
            packages: [],
          };
        })
      );
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('发货照片 URL 转换完成', {
          awardId: award.id,
          shipmentsCount: shipmentsWithUrls.length,
        });
      }

      // 转换收款二维码 URL
      // 如果存储的是完整的签名 URL，需要提取 key 并重新生成（因为签名 URL 会过期）
      let paymentQrCodeUrl = award.paymentQrCodeUrl;
      if (paymentQrCodeUrl) {
        if (paymentQrCodeUrl.startsWith('http://') || paymentQrCodeUrl.startsWith('https://')) {
          // 如果是完整的 URL，提取 key 并重新生成签名 URL
          try {
            const url = new URL(paymentQrCodeUrl);
            let keyFromUrl = url.pathname.substring(1); // 移除前导斜杠
            // 移除 bucket 名称前缀
            if (keyFromUrl.startsWith('eggpurchase/')) {
              keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
            }
            this.logger.debug('从完整 URL 提取 key', { keyFromUrl });
            paymentQrCodeUrl = await this.storageService.getFileUrl(keyFromUrl, 3600, requestOrigin);
          } catch (urlError) {
            this.logger.warn('无法从 URL 提取 key，尝试直接使用', { urlError });
            // 如果无法解析，尝试直接使用（向后兼容）
            paymentQrCodeUrl = await this.storageService.getFileUrl(paymentQrCodeUrl, 3600, requestOrigin);
          }
        } else {
          // 如果是文件 key，直接生成签名 URL
          paymentQrCodeUrl = await this.storageService.getFileUrl(paymentQrCodeUrl, 3600, requestOrigin);
        }
      }

      return {
        ...award,
        paymentQrCodeUrl,
        quote: {
          ...award.quote,
          items: quoteItemsWithOrder,
        },
        shipments: shipmentsWithUrls,
      };
    }));
  }

  async findBySupplier(supplierId: string, requestOrigin?: string) {
    this.logger.debug(`findBySupplier: 开始查询，供应商ID: ${supplierId}`);
    
    // 由于每个商品独立中标，我们需要查询：
    // 1. 该供应商的 Award 记录（如果有）
    // 2. 该供应商报价的商品中，哪些 RfqItem 的状态是 AWARDED
    // 3. 通过 QuoteItem 关联，找到该供应商中标的商品
    
    // 先查询该供应商的所有报价
    const quotes = await this.prisma.quote.findMany({
      where: { supplierId },
      include: {
        rfq: {
          include: {
            items: {
              include: {
                shipments: {
                  where: { supplierId },
                  include: {
                    packages: true,
                  },
                },
                order: {
                  // 直接通过 orderNo 关联的订单（推荐方式）
                  select: {
                    id: true,
                    orderNo: true,
                    orderTime: true,
                    userNickname: true,
                    openid: true,
                    recipient: true,
                    phone: true,
                    address: true,
                    modifiedAddress: true,
                    productName: true,
                    price: true,
                    points: true,
                    status: true,
                    shippedAt: true,
                    storeId: true,
                    store: {
                      select: {
                        name: true,
                      },
                    },
                  },
                } as any, // Type assertion for now, will be fixed after prisma generate
              } as any, // Type assertion for rfqItem include
            } as any, // Type assertion for items include
            orders: {
              // 保留 orders 关系用于兼容（但优先使用 item.order）
              include: {
                order: true,
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
        },
        items: {
          include: {
            rfqItem: {
              include: {
                order: {
                  // 直接通过 orderNo 关联的订单（推荐方式）
                  select: {
                    id: true,
                    orderNo: true,
                    orderTime: true,
                    userNickname: true,
                    openid: true,
                    recipient: true,
                    phone: true,
                    address: true,
                    modifiedAddress: true,
                    productName: true,
                    price: true,
                    points: true,
                    status: true,
                    shippedAt: true,
                    storeId: true,
                    store: {
                      select: {
                        name: true,
                      },
                    },
                  },
                } as any, // Type assertion for now, will be fixed after prisma generate
              } as any, // Type assertion for rfqItem include
            } as any, // Type assertion for quoteItem include
          },
        },
      },
      orderBy: {
        submittedAt: 'desc',
      },
    });

    // 过滤出该供应商中标的商品（RfqItem 状态为 AWARDED，且该供应商报价了该商品）
    const awardedItems: Array<{
      rfq: any;
      quote: any;
      quoteItem: any;
      rfqItem: any;
      price: number;
    }> = [];

    this.logger.debug(`findBySupplier: 供应商 ${supplierId} 共有 ${quotes.length} 个报价`);
    
    // 优化：先收集所有需要验证的 rfqItemId，然后批量查询所有报价
    // 这样可以避免 N+1 查询问题
    const rfqItemIdsToCheck = new Set<string>();
    const quoteItemMap = new Map<string, Array<{ quote: any; quoteItem: any; rfqItem: any }>>();
    
    // 第一遍遍历：收集所有需要验证的商品
    for (const quote of quotes) {
      const quoteWithRfq = quote as any; // Type assertion
      // 只处理已截标或已中标的询价单（RFQ 级别）
      if (quoteWithRfq.rfq.status !== 'CLOSED' && quoteWithRfq.rfq.status !== 'AWARDED') {
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`findBySupplier: 跳过报价 ${quote.id}，RFQ状态不是CLOSED或AWARDED`);
        }
        continue;
      }

      // 遍历该报价的所有商品，检查每个商品是否中标
      for (const quoteItem of quoteWithRfq.items) {
        const rfqItem = quoteItem.rfqItem;
        if (!rfqItem) {
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug(`findBySupplier: 报价项 ${quoteItem.id} 没有关联的 RfqItem`);
          }
          continue;
        }
        
        // 如果该商品的状态是 AWARDED，需要验证该供应商是否真的是中标供应商
        if (rfqItem.itemStatus === 'AWARDED') {
          rfqItemIdsToCheck.add(rfqItem.id);
          if (!quoteItemMap.has(rfqItem.id)) {
            quoteItemMap.set(rfqItem.id, []);
          }
          quoteItemMap.get(rfqItem.id)!.push({
            quote,
            quoteItem,
            rfqItem,
          });
        }
      }
    }
    
    // 批量查询所有需要验证的商品的所有报价（避免 N+1 查询）
    const allRfqItemIds = Array.from(rfqItemIdsToCheck);
    let allQuoteItemsForAllItems: any[] = [];
    
    if (allRfqItemIds.length > 0) {
      allQuoteItemsForAllItems = await this.prisma.quoteItem.findMany({
        where: {
          rfqItemId: { in: allRfqItemIds },
        },
        include: {
          quote: {
            select: {
              id: true,
              supplierId: true,
            },
          },
        },
      });
    }
    
    // 按 rfqItemId 分组所有报价
    const quoteItemsByRfqItem = new Map<string, any[]>();
    for (const quoteItem of allQuoteItemsForAllItems) {
      if (!quoteItemsByRfqItem.has(quoteItem.rfqItemId)) {
        quoteItemsByRfqItem.set(quoteItem.rfqItemId, []);
      }
      quoteItemsByRfqItem.get(quoteItem.rfqItemId)!.push(quoteItem);
    }
    
    // 第二遍遍历：验证每个商品是否中标
    for (const [rfqItemId, items] of quoteItemMap) {
      const allQuotesForItem = quoteItemsByRfqItem.get(rfqItemId) || [];
      
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`findBySupplier: 商品 ${rfqItemId} 共有 ${allQuotesForItem.length} 个报价`);
      }

      if (allQuotesForItem.length === 0) {
        this.logger.warn(`findBySupplier: 商品 ${rfqItemId} 没有报价，跳过`);
        continue;
      }

      // 优先查找 Award 记录，确定中标供应商（支持手动选商）
      // 查询该询价单的所有 Award 记录
      const rfqId = items[0]?.quote?.rfqId || items[0]?.rfqItem?.rfqId;
      let bestQuoteItem: any = null;
      
      if (rfqId) {
        const awards = await this.prisma.award.findMany({
          where: {
            rfqId: rfqId,
            status: { not: 'CANCELLED' },
          },
          include: {
            quote: {
              include: {
                items: {
                  where: {
                    rfqItemId: rfqItemId,
                  },
                },
              },
            },
          },
        });

        // 查找该商品的中标报价项（通过 Award 记录）
        for (const award of awards) {
          if (award.quote.items && award.quote.items.length > 0) {
            const awardedQuoteItem = award.quote.items[0];
            // 验证该报价项确实存在于 allQuotesForItem 中
            const matchingQuoteItem = allQuotesForItem.find(qi => qi.id === awardedQuoteItem.id);
            if (matchingQuoteItem) {
              bestQuoteItem = matchingQuoteItem;
              this.logger.debug(`findBySupplier: 通过 Award 记录找到中标报价项: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`);
              break;
            }
          }
        }
      }

      // 如果没有找到 Award 记录，使用价格最低的报价项（自动选商）
      if (!bestQuoteItem) {
        const sortedQuoteItems = allQuotesForItem.sort((a, b) => {
          const priceA = parseFloat(a.price.toString());
          const priceB = parseFloat(b.price.toString());
          return priceA - priceB;
        });
        bestQuoteItem = sortedQuoteItems[0];
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`findBySupplier: 未找到 Award 记录，使用最低报价: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`);
        }
      }

      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`findBySupplier: 商品 ${rfqItemId} 中标供应商: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}, 当前供应商: ${supplierId}`);
      }

      // ⚠️ 重要：只有当中标供应商是当前供应商时，才继续处理
      // 如果中标供应商不是当前供应商，直接跳过，不添加到 awardedItems
      if (bestQuoteItem.quote.supplierId !== supplierId) {
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`findBySupplier: 商品 ${rfqItemId} 的中标供应商是 ${bestQuoteItem.quote.supplierId}，不是当前供应商 ${supplierId}，跳过`);
        }
        continue; // 跳过这个商品，不添加到 awardedItems
      }

      // 检查该供应商是否中标了这个商品
      for (const { quote, quoteItem, rfqItem } of items) {
        // 如果该供应商的报价项是中标报价项，则说明中标了
        if (bestQuoteItem.id === quoteItem.id) {
          this.logger.debug(`findBySupplier: 供应商 ${supplierId} 中标商品 ${rfqItem.id} (${rfqItem.productName})，价格: ¥${quoteItem.price}`);
          awardedItems.push({
            rfq: quote.rfq,
            quote: quote,
            quoteItem: quoteItem,
            rfqItem: rfqItem, // rfqItem 应该已经包含 order 关系（从查询中获取）
            price: parseFloat(quoteItem.price.toString()),
          });
        } else if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`findBySupplier: 供应商 ${supplierId} 未中标商品 ${rfqItem.id}，中标供应商是 ${bestQuoteItem.quote.supplierId}`);
        }
      }
    }
    
    this.logger.debug(`findBySupplier: 供应商 ${supplierId} 共找到 ${awardedItems.length} 个中标商品`);

    // 按 RFQ 分组，为每个 RFQ 创建一个虚拟的 Award 对象
    const rfqGroups = new Map<string, typeof awardedItems>();
    for (const item of awardedItems) {
      const rfqId = item.rfq.id;
      if (!rfqGroups.has(rfqId)) {
        rfqGroups.set(rfqId, []);
      }
      rfqGroups.get(rfqId)!.push(item);
    }

    // 为每个 RFQ 创建虚拟 Award 对象（需要异步处理以查询发货单）
    const virtualAwards = await Promise.all(
      Array.from(rfqGroups.entries()).map(async ([rfqId, items]) => {
        const firstItem = items[0];
        const totalPrice = items.reduce((sum, item) => sum + item.price, 0);
        
        // 获取供应商信息
        const supplierInfo = firstItem.quote.supplier || {
          id: supplierId,
          username: '供应商',
          email: '',
        };
        
        // 收集所有 shipments，确保包含 packages
        // 先收集所有 rfqItemId
        const rfqItemIds = items.map(item => item.rfqItem.id);
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`findBySupplier: 需要查询发货单的商品IDs: ${rfqItemIds.join(', ')}`);
        }
        
        // 直接查询所有相关的发货单（通过 rfqItemId 和 supplierId）- 批量查询，避免 N+1
        const allShipmentsFromDb = await this.prisma.shipment.findMany({
          where: {
            rfqItemId: { in: rfqItemIds },
            supplierId: supplierId,
          },
          include: {
            packages: true,
          },
        });
        
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`findBySupplier: 从数据库查询到 ${allShipmentsFromDb.length} 个发货单`);
        }
        
        const allShipments = allShipmentsFromDb.map((shipment: any) => ({
          ...shipment,
          packages: shipment.packages || [],
        }));
        
        // 查找真实的 Award 记录（如果有），以获取 paymentQrCodeUrl
        let realAward = null;
        try {
          realAward = await this.prisma.award.findUnique({
            where: {
              rfqId_supplierId: {
                rfqId,
                supplierId,
              },
            },
            select: {
              paymentQrCodeUrl: true,
              updatedAt: true,
            },
          });
          if (realAward) {
            this.logger.debug('找到真实的 Award 记录', {
              paymentQrCodeUrl: realAward.paymentQrCodeUrl || '(空)',
            });
          }
        } catch (error) {
          this.logger.debug('查找真实 Award 记录时出错', { error });
        }
             
        return {
          id: `virtual-${rfqId}-${supplierId}`,
          rfqId,
          quoteId: firstItem.quote.id,
          supplierId,
          finalPrice: totalPrice,
          reason: `自动选商：按商品级别最优报价，共 ${items.length} 个商品中标`,
          awardedAt: firstItem.rfq.closeTime || firstItem.rfq.updatedAt,
          createdAt: firstItem.rfq.updatedAt,
          updatedAt: realAward?.updatedAt || firstItem.rfq.updatedAt,
          paymentQrCode: null,
          paymentQrCodeUrl: realAward?.paymentQrCodeUrl || null,
          cancellationReason: null,
          cancelledAt: null,
          cancelledBy: null,
          status: 'ACTIVE' as any,
          rfq: firstItem.rfq,
          quote: {
            ...firstItem.quote,
            // 确保保留完整的 quoteItem 结构，包括 rfqItem 及其 order 关系
            // 重要：必须完整保留 rfqItem 对象，包括其 order 关系
            items: items.map(item => {
              // 确保 rfqItem 及其所有关系（包括 order）都被完整保留
              const preservedRfqItem = {
                ...item.rfqItem,
                // 显式保留 order 关系（如果存在）
                order: (item.rfqItem as any).order,
              };
              return {
                ...item.quoteItem,
                rfqItem: preservedRfqItem, // 确保 rfqItem 及其 order 关系被保留
              };
            }),
          },
          supplier: supplierInfo,
          shipments: allShipments,
        };
      })
    );

    this.logger.debug('创建虚拟 Award 对象', { count: virtualAwards.length });
    
    // 为每个虚拟 Award 匹配订单信息并转换文件 URL
    // ⚠️ 权限控制：只有中标供应商才能看到订单信息
    // findBySupplier 已经验证了供应商ID，但这里再次确认以确保安全
    return Promise.all(virtualAwards.map(async (award) => {
      // 双重验证：确保 Award 的供应商ID与请求的供应商ID一致
      if (award.supplierId !== supplierId) {
        this.logger.warn('供应商发货管理 - 权限验证失败', {
          awardSupplierId: award.supplierId,
          requestedSupplierId: supplierId,
        });
        // 如果供应商ID不匹配，不返回订单信息
        return {
          ...award,
          quote: {
            ...award.quote,
            items: award.quote.items.map((quoteItem: any) => ({
              ...quoteItem,
              rfqItem: {
                ...quoteItem.rfqItem,
                orderInfo: null, // 不返回订单信息
              },
            })),
          },
        };
      }

      // 为每个 quoteItem 匹配订单信息
      // 优化：直接使用 rfqItem.order 获取订单信息，不再需要复杂的匹配逻辑
      // 注意：award.quote.items 中的 rfqItem 应该已经包含 order 关系（从查询中获取）
      const quoteItemsWithOrder = await Promise.all(award.quote.items.map(async (quoteItem: any) => {
        const rfqItem = quoteItem.rfqItem;
        
        // 调试：检查 rfqItem 是否包含 order 关系
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug('供应商发货管理 - 处理 quoteItem', {
            quoteItemId: quoteItem.id,
            rfqItemId: rfqItem?.id,
            hasRfqItem: !!rfqItem,
            hasOrder: !!(rfqItem as any)?.order,
            orderNo: rfqItem?.orderNo,
          });
        }
        if (!rfqItem) {
          return quoteItem;
        }

        // ⚠️ 权限控制：只有中标商品才能看到订单信息
        // 双重验证：1. 商品状态必须是 AWARDED
        if (rfqItem.itemStatus !== 'AWARDED') {
          this.logger.warn('供应商发货管理 - 商品未中标，不返回订单信息', {
            rfqItemId: rfqItem.id,
            productName: rfqItem.productName,
            itemStatus: rfqItem.itemStatus,
            supplierId: supplierId,
          });
          return {
            ...quoteItem,
            rfqItem: {
              ...rfqItem,
              orderInfo: null,
            },
          };
        }

        // ⚠️ 权限控制：2. 验证该报价项确实属于当前供应商
        // 注意：在虚拟 Award 中，quoteItem.quote 可能不完整，需要从 award.quote 或 award.supplierId 获取
        const quoteSupplierId = quoteItem.quote?.supplierId || award.quote?.supplierId || award.supplierId;
        if (quoteSupplierId !== supplierId) {
          this.logger.warn('供应商发货管理 - 报价项不属于当前供应商，不返回订单信息', {
            rfqItemId: rfqItem.id,
            quoteItemQuoteSupplierId: quoteItem.quote?.supplierId,
            awardQuoteSupplierId: award.quote?.supplierId,
            awardSupplierId: award.supplierId,
            requestedSupplierId: supplierId,
            finalQuoteSupplierId: quoteSupplierId,
            quoteItemKeys: Object.keys(quoteItem || {}),
            quoteKeys: Object.keys(quoteItem.quote || {}),
          });
          return {
            ...quoteItem,
            rfqItem: {
              ...rfqItem,
              orderInfo: null,
            },
          };
        }

        // 直接使用 rfqItem.order 获取订单信息（通过 orderNo 关联）
        // 这是最直接、最准确的方式
        // 注意：如果 rfqItem.order 不存在，可能是因为在创建虚拟 Award 时丢失了关系
        // 此时需要从 rfq.orders 中查找（向后兼容）
        let order = (rfqItem as any).order;
        
        // 调试：记录 rfqItem.order 的状态
        this.logger.debug('供应商发货管理 - 检查 rfqItem.order', {
          rfqItemId: rfqItem.id,
          orderNo: rfqItem.orderNo,
          hasOrderProperty: 'order' in (rfqItem as any),
          orderValue: order,
          orderType: typeof order,
          orderIsNull: order === null,
          orderIsUndefined: order === undefined,
        });
        
        // 如果直接关系不存在或为 null，尝试从 rfq.orders 中查找
        if ((!order || order === null) && rfqItem.orderNo && award.rfq?.orders) {
          this.logger.debug('供应商发货管理 - 尝试从 rfq.orders 中查找订单', {
            rfqItemId: rfqItem.id,
            orderNo: rfqItem.orderNo,
            rfqOrdersCount: (award.rfq as any).orders.length,
          });
          const matchedOrder = (award.rfq as any).orders.find(
            (or: any) => or.order && or.order.orderNo === rfqItem.orderNo
          )?.order;
          if (matchedOrder) {
            order = matchedOrder;
            this.logger.log('供应商发货管理 - 从 rfq.orders 中找到订单', {
              rfqItemId: rfqItem.id,
              orderNo: rfqItem.orderNo,
              hasRecipient: !!matchedOrder.recipient,
              hasPhone: !!matchedOrder.phone,
              hasAddress: !!matchedOrder.address,
            });
          } else {
            this.logger.debug('供应商发货管理 - rfq.orders 中未找到匹配的订单', {
              rfqItemId: rfqItem.id,
              orderNo: rfqItem.orderNo,
              availableOrderNos: (award.rfq as any).orders.map((or: any) => or.order?.orderNo).filter(Boolean),
            });
          }
        }
        
        // 如果仍然没有找到，尝试直接从数据库查询订单
        if ((!order || order === null) && rfqItem.orderNo) {
          this.logger.debug('供应商发货管理 - 尝试从数据库直接查询订单', {
            rfqItemId: rfqItem.id,
            orderNo: rfqItem.orderNo,
          });
          try {
            const dbOrder = await this.prisma.order.findUnique({
              where: { orderNo: rfqItem.orderNo },
              select: {
                id: true,
                orderNo: true,
                orderTime: true,
                userNickname: true,
                openid: true,
                recipient: true,
                phone: true,
                address: true,
                modifiedAddress: true,
                productName: true,
                price: true,
                points: true,
                status: true,
                shippedAt: true,
                storeId: true,
                store: {
                  select: {
                    name: true,
                  },
                },
              },
            });
            if (dbOrder) {
              order = dbOrder;
              this.logger.log('供应商发货管理 - 从数据库直接查询到订单', {
                rfqItemId: rfqItem.id,
                orderNo: rfqItem.orderNo,
                hasRecipient: !!dbOrder.recipient,
                hasPhone: !!dbOrder.phone,
                hasAddress: !!dbOrder.address,
              });
            } else {
              this.logger.warn('供应商发货管理 - 数据库中没有找到订单', {
                rfqItemId: rfqItem.id,
                orderNo: rfqItem.orderNo,
                message: '订单号在数据库中不存在',
              });
            }
          } catch (dbError) {
            this.logger.error('供应商发货管理 - 从数据库查询订单失败', {
              rfqItemId: rfqItem.id,
              orderNo: rfqItem.orderNo,
              error: dbError instanceof Error ? dbError.message : String(dbError),
              stack: dbError instanceof Error ? dbError.stack : undefined,
            });
          }
        }

        // 添加详细的调试日志（生产环境也记录，便于排查）
        this.logger.log('供应商发货管理 - 订单信息查询', {
          rfqItemId: rfqItem.id,
          productName: rfqItem.productName,
          itemOrderNo: rfqItem.orderNo,
          hasOrder: !!order,
          orderNo: order?.orderNo,
          hasRecipient: !!order?.recipient,
          hasPhone: !!order?.phone,
          hasAddress: !!order?.address,
          orderType: order === undefined ? 'undefined (可能需要运行 prisma generate)' : typeof order,
          // 检查 rfqItem 的结构
          rfqItemKeys: Object.keys(rfqItem || {}),
          hasOrderProperty: 'order' in (rfqItem as any),
          hasRfqOrders: !!(award.rfq as any)?.orders,
        });

        // 如果找到了订单，返回订单信息
        if (order) {
          return {
            ...quoteItem,
            rfqItem: {
              ...rfqItem,
              orderInfo: {
                orderNo: order.orderNo,
                recipient: order.recipient,
                phone: order.phone,
                address: order.modifiedAddress || order.address, // 优先使用修改后的地址
                modifiedAddress: order.modifiedAddress,
                userNickname: order.userNickname,
                openid: order.openid,
                orderTime: order.orderTime,
              },
            },
          };
        } else {
          // 如果没有订单（orderNo 为 NULL 或订单不存在），返回空订单信息
          this.logger.warn('供应商发货管理 - 未找到订单信息（所有查询方式都失败）', {
            rfqItemId: rfqItem.id,
            productName: rfqItem.productName,
            itemOrderNo: rfqItem.orderNo,
            hasRfqItemOrder: 'order' in (rfqItem as any),
            rfqItemOrderValue: (rfqItem as any).order,
            hasRfqOrders: !!(award.rfq as any)?.orders,
            rfqOrdersCount: (award.rfq as any)?.orders?.length || 0,
            message: '已尝试：1. rfqItem.order 2. rfq.orders 3. 数据库直接查询，均未找到订单',
          });
          return {
            ...quoteItem,
            rfqItem: {
              ...rfqItem,
              orderInfo: null,
            },
          };
        }
      }));

      // 转换发货照片 URL
      const shipmentsWithUrls = await Promise.all(
        (award.shipments || []).map(async (shipment: any) => {
          if (shipment.packages && shipment.packages.length > 0) {
            const packagesWithUrls = await Promise.all(
              shipment.packages.map(async (pkg: any) => {
                if (pkg.photos && pkg.photos.length > 0) {
                  const photoUrls = await Promise.all(
                    pkg.photos.map((photoKey: string) => 
                      this.storageService.getFileUrl(photoKey, 3600, requestOrigin)
                    )
                  );
                  return {
                    ...pkg,
                    photos: photoUrls,
                  };
                }
                return pkg;
              })
            );
            return {
              ...shipment,
              packages: packagesWithUrls,
            };
          }
          return shipment;
        })
      );

      // 转换收款二维码 URL
      // 如果存储的是完整的签名 URL，需要提取 key 并重新生成（因为签名 URL 会过期）
      let paymentQrCodeUrl = award.paymentQrCodeUrl;
      if (paymentQrCodeUrl) {
        if (paymentQrCodeUrl.startsWith('http://') || paymentQrCodeUrl.startsWith('https://')) {
          // 如果是完整的 URL，提取 key 并重新生成签名 URL
          try {
            const url = new URL(paymentQrCodeUrl);
            let keyFromUrl = url.pathname.substring(1); // 移除前导斜杠
            // 移除 bucket 名称前缀
            if (keyFromUrl.startsWith('eggpurchase/')) {
              keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
            }
            this.logger.debug('从完整 URL 提取 key', { keyFromUrl });
            paymentQrCodeUrl = await this.storageService.getFileUrl(keyFromUrl, 3600, requestOrigin);
          } catch (urlError) {
            this.logger.warn('无法从 URL 提取 key，尝试直接使用', { urlError });
            // 如果无法解析，尝试直接使用（向后兼容）
            paymentQrCodeUrl = await this.storageService.getFileUrl(paymentQrCodeUrl, 3600, requestOrigin);
          }
        } else {
          // 如果是文件 key，直接生成签名 URL
          paymentQrCodeUrl = await this.storageService.getFileUrl(paymentQrCodeUrl, 3600, requestOrigin);
        }
      }

      // 最终返回前，再次检查 orderInfo 是否被正确设置
      const finalQuoteItems = quoteItemsWithOrder.map((item: any) => {
        const rfqItem = item.rfqItem;
        if (rfqItem && rfqItem.orderNo && !rfqItem.orderInfo) {
          // 如果 rfqItem 有 orderNo 但没有 orderInfo，记录警告
          this.logger.warn('供应商发货管理 - orderInfo 未设置', {
            quoteItemId: item.id,
            rfqItemId: rfqItem.id,
            productName: rfqItem.productName,
            orderNo: rfqItem.orderNo,
            itemStatus: rfqItem.itemStatus,
          });
        }
        return item;
      });

      return {
        ...award,
        paymentQrCodeUrl,
        quote: {
          ...award.quote,
          items: finalQuoteItems,
        },
        shipments: shipmentsWithUrls,
      };
    }));
  }

  async uploadPaymentQrCode(awardId: string, file: Express.Multer.File, supplierId: string) {
    this.logger.debug('uploadPaymentQrCode 开始', {
      awardId,
      supplierId,
      fileName: file?.originalname || 'null',
    });
    
    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    let realAwardId = awardId;
    let rfqId: string;

    // 检查是否是虚拟 Award ID（格式：virtual-${rfqId}-${supplierId}）
    if (awardId.startsWith('virtual-')) {
      this.logger.debug('检测到虚拟 Award ID', { awardId });
      // 从虚拟 ID 中提取 rfqId 和 supplierId
      const prefix = 'virtual-';
      const idWithoutPrefix = awardId.substring(prefix.length);
      const lastDashIndex = idWithoutPrefix.lastIndexOf('-');
      
      this.logger.debug('解析虚拟 ID', { idWithoutPrefix, lastDashIndex });
      
      if (lastDashIndex === -1 || lastDashIndex === 0 || lastDashIndex === idWithoutPrefix.length - 1) {
        this.logger.error('虚拟 ID 格式无效', { awardId });
        throw new BadRequestException('Invalid virtual award ID format');
      }
      
      rfqId = idWithoutPrefix.substring(0, lastDashIndex);
      const supplierIdFromId = idWithoutPrefix.substring(lastDashIndex + 1);
      
      this.logger.debug('从虚拟 ID 提取', { rfqId, supplierIdFromId, currentSupplierId: supplierId });
      
      if (supplierIdFromId !== supplierId) {
        this.logger.error('供应商 ID 不匹配', { supplierIdFromId, supplierId });
        throw new BadRequestException('Award ID does not match current supplier');
      }
      
      this.logger.debug('供应商 ID 验证通过');

      // 首先需要获取 RFQ 和 Quote 信息
      const rfqData = await this.prisma.rfq.findUnique({
        where: { id: rfqId },
      });

      if (!rfqData) {
        throw new NotFoundException('RFQ not found');
      }

      // 找到该供应商的报价（不限制状态，因为可能是部分商品中标）
      const quote = await this.prisma.quote.findFirst({
        where: {
          rfqId: rfqId,
          supplierId: supplierId,
        },
      });

      if (!quote) {
        this.logger.warn('未找到供应商在 RFQ 中的报价', { supplierId, rfqId });
        // 检查是否有任何报价
        const anyQuote = await this.prisma.quote.findFirst({
          where: { rfqId: rfqId },
          select: { id: true, supplierId: true, status: true },
        });
        if (anyQuote) {
          this.logger.debug('RFQ 存在其他报价', {
            rfqId,
            supplierId: anyQuote.supplierId,
            status: anyQuote.status,
          });
        }
        throw new BadRequestException('Quote not found for this supplier in this RFQ');
      }

      this.logger.debug('找到报价', { quoteId: quote.id, status: quote.status });
      
      // 检查是否已有使用该 quoteId 的 Award 记录（quoteId 是唯一的，每个供应商的 Quote 是唯一的）
      let existingAwardByQuote = null;
      try {
        existingAwardByQuote = await this.prisma.award.findUnique({
          where: { quoteId: quote.id },
        });
        if (existingAwardByQuote) {
          this.logger.debug('找到使用该 quoteId 的现有 Award 记录', {
            awardId: existingAwardByQuote.id,
            supplierId: existingAwardByQuote.supplierId,
          });
        } else {
          this.logger.debug('未找到使用该 quoteId 的 Award 记录');
        }
      } catch (error: any) {
        this.logger.debug('查找 Award 记录时出错', { error: error?.message || error });
      }

      if (existingAwardByQuote) {
        // 验证供应商是否匹配
        if (existingAwardByQuote.supplierId !== supplierId) {
          throw new BadRequestException('Award already exists for this quote but belongs to a different supplier');
        }
        realAwardId = existingAwardByQuote.id;
        this.logger.debug('找到使用该 quoteId 的现有 Award 记录', { realAwardId });
      } else {
        // 验证该供应商是否真的中标了该 RFQ 中的至少一个商品
        const awardedItems = await this.prisma.rfqItem.findMany({
            where: {
              rfqId: rfqId,
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

          // 检查该供应商是否中标了至少一个商品
          const supplierWonAnyItem = awardedItems.some(item => {
            if (!item.quoteItems || item.quoteItems.length === 0) return false;
            const bestQuoteItem = item.quoteItems.reduce((best, current) => {
              const bestPrice = parseFloat(best.price.toString());
              const currentPrice = parseFloat(current.price.toString());
              return currentPrice < bestPrice ? current : best;
            });
            return bestQuoteItem.quote.supplierId === supplierId;
          });

          if (!supplierWonAnyItem) {
            this.logger.warn('供应商未中标 RFQ 中的任何商品', { supplierId, rfqId });
            throw new BadRequestException('You have not won any items in this RFQ');
          }

          // 计算该供应商在该 RFQ 中所有中标商品的总价
          let totalPrice = 0;
          for (const item of awardedItems) {
            if (item.quoteItems && item.quoteItems.length > 0) {
              // 找到该供应商的报价项（价格最低的）
              const supplierQuoteItems = item.quoteItems.filter(
                qi => qi.quote.supplierId === supplierId
              );
              if (supplierQuoteItems.length > 0) {
                const bestQuoteItem = supplierQuoteItems.reduce((best, current) => {
                  const bestPrice = parseFloat(best.price.toString());
                  const currentPrice = parseFloat(current.price.toString());
                  return currentPrice < bestPrice ? current : best;
                });
                totalPrice += parseFloat(bestQuoteItem.price.toString()) * (item.quantity || 1);
              }
            }
          }

        // 尝试创建 Award 记录
        // 注意：由于 rfqId 是唯一的，如果已经有其他供应商的 Award，创建会失败
        // 但现在是按商品中标，每个供应商可以有自己的 Award，所以需要处理 rfqId 冲突
        try {
          const newAward = await this.prisma.award.create({
            data: {
              rfqId: rfqId,
              quoteId: quote.id,
              supplierId: supplierId,
              finalPrice: totalPrice,
              reason: '自动创建（上传收款二维码）',
            },
          });

          realAwardId = newAward.id;
          this.logger.log('创建新的 Award 记录', { realAwardId, totalPrice });

          // ⚠️ 重要：更新 quote.status 和 quote.price
          await this.prisma.quote.update({
            where: { id: quote.id },
            data: {
              status: 'AWARDED',
              price: totalPrice, // 更新 price，只包含真正中标的商品
            },
          });
          this.logger.log('已更新 quote.status 和 quote.price', {
            quoteId: quote.id,
            status: 'AWARDED',
            price: totalPrice,
          });
        } catch (createError: any) {
          // 如果创建失败（可能是唯一约束冲突），再次查找
          if (createError.code === 'P2002') {
            this.logger.debug('创建 Award 失败（唯一约束冲突）', { meta: createError.meta });
            // 先尝试通过 quoteId 查找（这是最准确的，因为 quoteId 是唯一的）
            const conflictAwardByQuote = await this.prisma.award.findUnique({
              where: { quoteId: quote.id },
            });
            
            if (conflictAwardByQuote) {
              // 如果通过 quoteId 找到了，说明已经有该供应商的 Award
              if (conflictAwardByQuote.supplierId !== supplierId) {
                throw new BadRequestException('Award already exists for this quote but belongs to a different supplier');
              }
              realAwardId = conflictAwardByQuote.id;
              this.logger.debug('通过 quoteId 找到现有 Award 记录', { realAwardId });
            } else {
              // 如果通过 quoteId 没找到，但创建失败，可能是 rfqId 冲突
              // 这种情况下，说明已经有其他供应商的 Award，但当前供应商也应该有自己的 Award
              // 由于 schema 中 rfqId 是 @unique，这需要修改 schema
              this.logger.error('创建失败：rfqId 冲突，但 quoteId 未找到现有记录。这表示 schema 中 rfqId 的 @unique 约束阻止了多个供应商为同一 RFQ 创建 Award。需要修改 schema，移除 rfqId 的 @unique 约束，或使用复合唯一约束 (rfqId, supplierId)');
              throw new BadRequestException('Cannot create Award: RFQ already has an Award from another supplier. Schema constraint prevents multiple Awards per RFQ.');
            }
          } else {
            throw createError;
          }
        }
      }
    } else {
      // 如果是真实的 Award ID，验证权限
      const award = await this.prisma.award.findUnique({
        where: { id: awardId },
      });

      if (!award) {
        throw new NotFoundException('Award not found');
      }

      if (award.supplierId !== supplierId) {
        throw new BadRequestException('You can only upload QR code for your own awards');
      }
      realAwardId = award.id;
      this.logger.debug('使用真实 Award ID', { realAwardId });
    }

    if (!realAwardId) {
      this.logger.error('realAwardId 未设置！');
      throw new BadRequestException('Invalid award ID');
    }

    this.logger.debug('准备上传文件到 MinIO', { realAwardId });

    // 上传到 MinIO
    // 注意：uploadFile 返回的是签名 URL，但我们应该存储文件 key，以便后续可以重新生成签名 URL
    let fileKey: string;
    let fileUrl: string;
    try {
      // 先上传文件获取签名 URL
      fileUrl = await this.storageService.uploadFile(file, 'payment-qrcodes');
      this.logger.debug('文件上传成功', { fileUrl });
      
      // 从签名 URL 中提取文件 key（用于存储到数据库）
      // URL 格式：http://localhost:9000/eggpurchase/payment-qrcodes/...?X-Amz-...
      try {
        const url = new URL(fileUrl);
        let keyFromUrl = url.pathname.substring(1); // 移除前导斜杠
        // 移除 bucket 名称前缀
        if (keyFromUrl.startsWith('eggpurchase/')) {
          keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
        }
        fileKey = keyFromUrl;
        this.logger.debug('从 URL 提取文件 key', { fileKey });
      } catch (urlError) {
        // 如果无法解析 URL，使用完整 URL 作为 key（向后兼容）
        this.logger.warn('无法从 URL 提取 key，使用完整 URL', { urlError });
        fileKey = fileUrl;
      }
    } catch (uploadError: any) {
      this.logger.error('文件上传失败', { uploadError });
      throw new BadRequestException(`文件上传失败: ${uploadError.message || 'MinIO 连接失败，请检查 MinIO 服务是否运行'}`);
    }

    // 更新 Award（存储文件 key 而不是完整的签名 URL）
    this.logger.debug('准备更新 Award 记录', { realAwardId, fileKey });
    const updated = await this.prisma.award.update({
      where: { id: realAwardId },
      data: {
        paymentQrCodeUrl: fileKey, // 存储文件 key，而不是完整的签名 URL
      },
    });

    this.logger.log('Award 更新成功', { awardId: updated.id });
    return updated;
  }

  async uploadTrackingNumber(
    awardId: string,
    rfqItemId: string,
    trackingNo: string,
    carrier: string,
    supplierId: string,
  ) {
    let award: any = null;
    let rfqId: string;
    let rfqData: any;

    // 检查是否是虚拟 Award ID（格式：virtual-${rfqId}-${supplierId}）
    if (awardId.startsWith('virtual-')) {
      this.logger.debug('检测到虚拟 Award ID', { awardId });
      // 从虚拟 ID 中提取 rfqId 和 supplierId
      // 格式：virtual-${rfqId}-${supplierId}
      // 使用 lastIndexOf 找到最后一个 '-' 的位置，这样可以正确处理包含连字符的 ID
      const prefix = 'virtual-';
      const idWithoutPrefix = awardId.substring(prefix.length);
      const lastDashIndex = idWithoutPrefix.lastIndexOf('-');
      
      if (lastDashIndex === -1 || lastDashIndex === 0 || lastDashIndex === idWithoutPrefix.length - 1) {
        throw new BadRequestException('Invalid virtual award ID format');
      }
      
      const rfqIdFromId = idWithoutPrefix.substring(0, lastDashIndex);
      const supplierIdFromId = idWithoutPrefix.substring(lastDashIndex + 1);
      
      this.logger.debug('从虚拟 ID 提取', { rfqId: rfqIdFromId, supplierId: supplierIdFromId });
      
      if (supplierIdFromId !== supplierId) {
        throw new BadRequestException('Award ID does not match current supplier');
      }

      rfqId = rfqIdFromId;

      // 查询 RFQ 信息
      rfqData = await this.prisma.rfq.findUnique({
        where: { id: rfqId },
        include: {
          items: true,
        },
      });

      if (!rfqData) {
        throw new NotFoundException('RFQ not found');
      }

      // 验证该供应商是否真的中标了该商品
      const rfqItem = rfqData.items.find(item => item.id === rfqItemId);
      if (!rfqItem) {
        throw new BadRequestException('RFQ item not found in this RFQ');
      }

      if (rfqItem.itemStatus !== 'AWARDED') {
        throw new BadRequestException('This item is not awarded');
      }

      // 验证该供应商是否真的中标了该商品（通过比较价格）
      const allQuotesForItem = await this.prisma.quoteItem.findMany({
        where: { rfqItemId },
        include: {
          quote: {
            select: {
              id: true,
              supplierId: true,
            },
          },
        },
      });

      const bestQuoteItem = allQuotesForItem.reduce((best, current) => {
        const bestPrice = parseFloat(best.price.toString());
        const currentPrice = parseFloat(current.price.toString());
        return currentPrice < bestPrice ? current : best;
      });

      if (bestQuoteItem.quote.supplierId !== supplierId) {
        throw new BadRequestException('You can only upload tracking number for items you won');
      }

      // 创建虚拟 Award 对象用于后续处理
      award = {
        id: awardId,
        rfqId,
        supplierId,
        rfq: rfqData,
      };
    } else {
      // 真实 Award ID，从数据库查询
      award = await this.prisma.award.findUnique({
        where: { id: awardId },
        include: {
          rfq: {
            include: {
              items: true,
            },
          },
        },
      });

      if (!award) {
        throw new NotFoundException('Award not found');
      }

      if (award.supplierId !== supplierId) {
        throw new BadRequestException('You can only upload tracking number for your own awards');
      }

      rfqId = award.rfqId;
      rfqData = award.rfq;

      // 检查 rfqItem 是否属于该询价单
      const rfqItem = rfqData.items.find(item => item.id === rfqItemId);
      if (!rfqItem) {
        throw new BadRequestException('RFQ item not found in this RFQ');
      }

      // ⚠️ 重要：验证该供应商是否真的中标了该商品（防止错误上传）
      if (rfqItem.itemStatus !== 'AWARDED') {
        throw new BadRequestException('This item is not awarded');
      }

      // 验证该供应商是否真的中标了该商品（通过比较价格或 Award 记录）
      const allQuotesForItem = await this.prisma.quoteItem.findMany({
        where: { rfqItemId },
        include: {
          quote: {
            select: {
              id: true,
              supplierId: true,
            },
          },
        },
      });

      if (allQuotesForItem.length === 0) {
        throw new BadRequestException('No quotes found for this item');
      }

      // 优先查找 Award 记录，确定中标供应商（支持手动选商）
      let bestQuoteItem: any = null;
      const awards = await this.prisma.award.findMany({
        where: {
          rfqId: rfqId,
          status: { not: 'CANCELLED' },
        },
        include: {
          quote: {
            include: {
              items: {
                where: {
                  rfqItemId: rfqItemId,
                },
              },
            },
          },
        },
      });

      // 查找该商品的中标报价项（通过 Award 记录）
      for (const awardRecord of awards) {
        if (awardRecord.quote.items && awardRecord.quote.items.length > 0) {
          const awardedQuoteItem = awardRecord.quote.items[0];
          const matchingQuoteItem = allQuotesForItem.find(qi => qi.id === awardedQuoteItem.id);
          if (matchingQuoteItem) {
            bestQuoteItem = matchingQuoteItem;
            this.logger.debug(`通过 Award 记录找到中标报价项: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`);
            break;
          }
        }
      }

      // 如果没有找到 Award 记录，使用价格最低的报价项（自动选商）
      if (!bestQuoteItem) {
        const sortedQuoteItems = allQuotesForItem.sort((a, b) => {
          const priceA = parseFloat(a.price.toString());
          const priceB = parseFloat(b.price.toString());
          return priceA - priceB;
        });
        bestQuoteItem = sortedQuoteItems[0];
        this.logger.debug(`未找到 Award 记录，使用最低报价: ${bestQuoteItem.quote.supplierId}, 价格: ¥${bestQuoteItem.price}`);
      }

      // 验证中标供应商是否是当前供应商
      if (bestQuoteItem.quote.supplierId !== supplierId) {
        this.logger.warn('供应商尝试上传非中标商品的物流信息', {
          supplierId,
          winningSupplierId: bestQuoteItem.quote.supplierId,
          rfqItemId,
          productName: rfqItem.productName,
        });
        throw new BadRequestException('You can only upload tracking number for items you won');
      }
    }

    // 检查物流单号是否已存在（排除临时单号）
    // 注意：现在允许同一快递单号对应多个商品（同一供应商、同一RFQ）
    // 所以不再检查唯一性，而是允许共享运单号
    if (trackingNo && !trackingNo.startsWith('TEMP-')) {
      // 可选：检查是否属于不同供应商或不同RFQ，如果是则提示警告（但不阻止）
      const existingShipments = await this.prisma.shipment.findMany({
        where: { trackingNo },
        select: {
          id: true,
          supplierId: true,
          awardId: true,
          rfqItemId: true,
        },
      });

      if (existingShipments.length > 0) {
        // 检查是否有不同供应商或不同RFQ的发货单
        const currentRfqId = rfqId; // 从上下文获取
        let hasConflict = false;
        for (const existing of existingShipments) {
          if (existing.supplierId !== supplierId) {
            hasConflict = true; // 不同供应商
            break;
          }
          
          // 检查是否属于同一RFQ
          let existingRfqId: string | null = null;
          if (existing.awardId) {
            const award = await this.prisma.award.findUnique({
              where: { id: existing.awardId },
              select: { rfqId: true },
            });
            existingRfqId = award?.rfqId || null;
          } else if (existing.rfqItemId) {
            const rfqItem = await this.prisma.rfqItem.findUnique({
              where: { id: existing.rfqItemId },
              select: { rfqId: true },
            });
            existingRfqId = rfqItem?.rfqId || null;
          }
          
          if (existingRfqId !== currentRfqId) {
            hasConflict = true; // 不同RFQ
            break;
          }
        }

        if (hasConflict) {
          this.logger.warn('运单号已被其他供应商或不同RFQ的发货单使用，但允许继续创建', { trackingNo });
          // 不抛出错误，允许继续（因为可能是同一供应商同一RFQ的多个商品）
        } else {
          this.logger.debug('运单号已存在，属于同一供应商和同一RFQ，可以共享', { trackingNo });
        }
      }
    }

    // 如果是虚拟 Award ID，需要找到或创建真实的 Award 记录
    let realAwardId = awardId;
    if (awardId.startsWith('virtual-')) {
      // 从虚拟 ID 中提取 rfqId 和 supplierId
      const prefix = 'virtual-';
      const idWithoutPrefix = awardId.substring(prefix.length);
      const lastDashIndex = idWithoutPrefix.lastIndexOf('-');
      
      if (lastDashIndex === -1 || lastDashIndex === 0 || lastDashIndex === idWithoutPrefix.length - 1) {
        throw new BadRequestException('Invalid virtual award ID format');
      }
      
      const rfqIdFromId = idWithoutPrefix.substring(0, lastDashIndex);
      const supplierIdFromId = idWithoutPrefix.substring(lastDashIndex + 1);
      
      // 查找是否已有真实的 Award 记录（通过 rfqId 和 supplierId 查找，使用复合唯一约束）
      const existingAward = await this.prisma.award.findUnique({
        where: {
          rfqId_supplierId: {
            rfqId: rfqIdFromId,
            supplierId: supplierIdFromId,
          },
        },
      });

      if (existingAward) {
        realAwardId = existingAward.id;
        this.logger.debug('找到现有的 Award 记录', { realAwardId });
      } else {
        // 如果没有真实的 Award 记录，创建一个
        // 计算该供应商在该 RFQ 中所有中标商品的总价
        const awardedItems = await this.prisma.rfqItem.findMany({
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

        let totalPrice = 0;
        let firstQuoteId = '';
        for (const item of awardedItems) {
          if (item.quoteItems && item.quoteItems.length > 0) {
            // 找到该供应商的报价项（价格最低的）
            const supplierQuoteItems = item.quoteItems.filter(
              qi => qi.quote.supplierId === supplierId
            );
            if (supplierQuoteItems.length > 0) {
              const bestQuoteItem = supplierQuoteItems.reduce((best, current) => {
                const bestPrice = parseFloat(best.price.toString());
                const currentPrice = parseFloat(current.price.toString());
                return currentPrice < bestPrice ? current : best;
              });
              totalPrice += parseFloat(bestQuoteItem.price.toString()) * (item.quantity || 1);
              if (!firstQuoteId) {
                firstQuoteId = bestQuoteItem.quote.id;
              }
            }
          }
        }

        if (firstQuoteId) {
          const newAward = await this.prisma.award.create({
            data: {
              rfqId,
              quoteId: firstQuoteId,
              supplierId,
              finalPrice: totalPrice,
              reason: `按商品级别选商，共 ${awardedItems.length} 个商品`,
            },
          });
          realAwardId = newAward.id;
          this.logger.log('创建了真实的 Award 记录', { realAwardId });

          // ⚠️ 重要：更新 quote.status 和 quote.price
          await this.prisma.quote.update({
            where: { id: firstQuoteId },
            data: {
              status: 'AWARDED',
              price: totalPrice, // 更新 price，只包含真正中标的商品
            },
          });
          this.logger.log('已更新 quote.status 和 quote.price', {
            quoteId: firstQuoteId,
            status: 'AWARDED',
            price: totalPrice,
          });
        } else {
          throw new BadRequestException('Cannot create award: no quote found for this supplier');
        }
      }
    }

    // 创建发货单
    const shipment = await this.prisma.shipment.create({
      data: {
        shipmentNo: `SHIP-${Date.now()}`,
        awardId: realAwardId,
        supplierId,
        rfqItemId,
        trackingNo,
        carrier,
        source: 'SUPPLIER',
        status: 'SHIPPED',
        shippedAt: new Date(),
      },
    });

    // 更新 RfqItem 的 source、shipmentId、trackingNo 和 carrier
    // 这样管理员和采购员就能看到快递单号了
    const updatedRfqItem = await this.prisma.rfqItem.update({
      where: { id: rfqItemId },
      data: {
        shipmentId: shipment.id,
        source: 'SUPPLIER',
        trackingNo: trackingNo, // 同步快递单号到 RfqItem
        carrier: carrier || null, // 同步快递公司到 RfqItem
      },
    });

    this.logger.debug('供应商上传物流单号后，更新 RfqItem', {
      id: updatedRfqItem.id,
      productName: updatedRfqItem.productName,
      trackingNo: updatedRfqItem.trackingNo,
      carrier: updatedRfqItem.carrier,
      source: updatedRfqItem.source,
      shipmentId: updatedRfqItem.shipmentId,
    });

    // 通知管理员和采购员
    // 使用实际保存的物流单号（而不是传入的参数，因为可能被OCR识别后更新）
    const actualTrackingNo = shipment.trackingNo || updatedRfqItem.trackingNo || trackingNo;
    
    // 如果是临时单号（以TEMP-开头），不发送通知，因为后续OCR识别后会发送正确的通知
    const isTempTrackingNo = actualTrackingNo && actualTrackingNo.startsWith('TEMP-');
    
    if (isTempTrackingNo) {
      this.logger.debug(`检测到临时物流单号 ${actualTrackingNo}，跳过通知（等待OCR识别后发送）`);
      return {
        ...shipment,
        shipmentId: shipment.id,
        realAwardId: realAwardId,
      };
    }
    
    const rfqForNotification = await this.prisma.rfq.findUnique({
      where: { id: rfqId },
      include: {
        buyer: true,
      },
    });

    if (rfqForNotification) {
      // 获取所有需要通知的用户（管理员和采购员），去重避免重复通知
      const admins = await this.prisma.user.findMany({
        where: { role: 'ADMIN' },
        select: { id: true, username: true },
      });

      // 获取采购员信息
      const buyer = rfqForNotification.buyer;
      
      // 创建用户ID集合，避免重复通知
      const notifiedUserIds = new Set<string>();
      
      // 通知采购员（如果采购员不是管理员，避免重复）
      if (buyer && !notifiedUserIds.has(rfqForNotification.buyerId)) {
        const isBuyerAdmin = admins.some(admin => admin.id === rfqForNotification.buyerId);
        if (!isBuyerAdmin) {
          await this.notificationService.create({
            userId: rfqForNotification.buyerId,
            type: 'SHIPMENT_UPDATE',
            title: '物流单号已更新',
            content: `供应商已上传物流单号：${actualTrackingNo}${carrier ? `（${carrier}）` : ''}，商品：${updatedRfqItem.productName}`,
            link: `/rfqs/${rfqId}`,
            userName: buyer?.username || undefined,
          });
          notifiedUserIds.add(rfqForNotification.buyerId);
        }
      }

      // 通知所有管理员（去重，避免重复通知）
      for (const admin of admins) {
        if (!notifiedUserIds.has(admin.id)) {
          await this.notificationService.create({
            userId: admin.id,
            type: 'SHIPMENT_UPDATE',
            title: '物流单号已更新',
            content: `供应商已上传物流单号：${actualTrackingNo}${carrier ? `（${carrier}）` : ''}，商品：${updatedRfqItem.productName}`,
            link: `/rfqs/${rfqId}`,
            userName: admin.username || undefined,
          });
          notifiedUserIds.add(admin.id);
        }
      }

      this.logger.debug(`已通知 ${notifiedUserIds.size} 个用户关于物流单号更新：${actualTrackingNo}`);
    }

    // 返回 shipment 信息，包括 shipmentId，这样前端就不需要重新查询了
    return {
      ...shipment,
      shipmentId: shipment.id, // 为了兼容性，也返回 shipmentId
      realAwardId: realAwardId, // 返回真实的 Award ID，前端可能需要
    };
  }

  async uploadShipmentPhotos(
    awardId: string,
    rfqItemId: string,
    file: Express.Multer.File,
    supplierId: string,
  ) {
    try {
      let award: any = null;
      let rfqId: string;
      let rfqDataForPhoto: any;

      // 检查是否是虚拟 Award ID（格式：virtual-${rfqId}-${supplierId}）
      if (awardId.startsWith('virtual-')) {
        this.logger.debug('检测到虚拟 Award ID', { awardId });
        // 从虚拟 ID 中提取 rfqId 和 supplierId
        const prefix = 'virtual-';
        const idWithoutPrefix = awardId.substring(prefix.length);
        const lastDashIndex = idWithoutPrefix.lastIndexOf('-');
        
        if (lastDashIndex === -1 || lastDashIndex === 0 || lastDashIndex === idWithoutPrefix.length - 1) {
          throw new BadRequestException('Invalid virtual award ID format');
        }
        
        const rfqIdFromId = idWithoutPrefix.substring(0, lastDashIndex);
        const supplierIdFromId = idWithoutPrefix.substring(lastDashIndex + 1);
        
        this.logger.debug('从虚拟 ID 提取', { rfqId: rfqIdFromId, supplierId: supplierIdFromId });
        
        if (supplierIdFromId !== supplierId) {
          throw new BadRequestException('Award ID does not match current supplier');
        }

        rfqId = rfqIdFromId;

        // 查询 RFQ 信息
        rfqDataForPhoto = await this.prisma.rfq.findUnique({
          where: { id: rfqId },
          include: {
            items: true,
          },
        });

        if (!rfqDataForPhoto) {
          throw new NotFoundException('RFQ not found');
        }

        // 验证该供应商是否真的中标了该商品
        const rfqItem = rfqDataForPhoto.items.find(item => item.id === rfqItemId);
        if (!rfqItem) {
          throw new BadRequestException('RFQ item not found in this RFQ');
        }

        if (rfqItem.itemStatus !== 'AWARDED') {
          throw new BadRequestException('This item is not awarded');
        }

        // 验证该供应商是否真的中标了该商品（使用与 findByBuyer 相同的逻辑）
        const allQuotesForItem = await this.prisma.quoteItem.findMany({
          where: { rfqItemId },
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
        });

        if (allQuotesForItem.length === 0) {
          throw new BadRequestException('No quotes found for this item');
        }

        // 使用与 findByBuyer 相同的逻辑选择最佳报价
        const instantPrice = rfqItem.instantPrice ? parseFloat(rfqItem.instantPrice.toString()) : null;
        let bestQuoteItem: any = null;

        if (instantPrice) {
          // 如果有一口价，优先选择满足一口价的报价，按提交时间排序（最早提交的优先）
          const instantPriceQuotes = allQuotesForItem
            .filter((item: any) => parseFloat(item.price.toString()) <= instantPrice)
            .sort((a: any, b: any) => {
              const timeA = a.quote?.submittedAt || a.quote?.createdAt || new Date(0);
              const timeB = b.quote?.submittedAt || b.quote?.createdAt || new Date(0);
              return new Date(timeA).getTime() - new Date(timeB).getTime();
            });
          
          if (instantPriceQuotes.length > 0) {
            bestQuoteItem = instantPriceQuotes[0];
          } else {
            // 没有满足一口价的，按价格排序（价格相同，按提交时间排序）
            allQuotesForItem.sort((a: any, b: any) => {
              const priceA = parseFloat(a.price.toString());
              const priceB = parseFloat(b.price.toString());
              if (priceA !== priceB) {
                return priceA - priceB;
              }
              const timeA = a.quote?.submittedAt || a.quote?.createdAt || new Date(0);
              const timeB = b.quote?.submittedAt || b.quote?.createdAt || new Date(0);
              return new Date(timeA).getTime() - new Date(timeB).getTime();
            });
            bestQuoteItem = allQuotesForItem[0];
          }
        } else {
          // 没有一口价，按价格排序（价格相同，按提交时间排序）
          allQuotesForItem.sort((a: any, b: any) => {
            const priceA = parseFloat(a.price.toString());
            const priceB = parseFloat(b.price.toString());
            if (priceA !== priceB) {
              return priceA - priceB;
            }
            const timeA = a.quote?.submittedAt || a.quote?.createdAt || new Date(0);
            const timeB = b.quote?.submittedAt || b.quote?.createdAt || new Date(0);
            return new Date(timeA).getTime() - new Date(timeB).getTime();
          });
          bestQuoteItem = allQuotesForItem[0];
        }

        if (!bestQuoteItem) {
          throw new BadRequestException('Unable to determine the winning supplier for this item');
        }

        if (bestQuoteItem.quote.supplierId !== supplierId) {
          this.logger.warn(`uploadShipmentPhotos: 供应商 ${supplierId} 尝试上传照片，但实际中标供应商是 ${bestQuoteItem.quote.supplierId}`, {
            rfqItemId,
            instantPrice,
            bestPrice: bestQuoteItem.price,
            bestSupplierId: bestQuoteItem.quote.supplierId,
            currentSupplierId: supplierId,
          });
          throw new BadRequestException('You can only upload photos for items you won');
        }

        // 创建虚拟 Award 对象用于后续处理
        award = {
          id: awardId,
          rfqId,
          supplierId,
          rfq: rfqDataForPhoto,
        };
      } else {
        // 真实 Award ID，从数据库查询
        award = await this.prisma.award.findUnique({
          where: { id: awardId },
          include: {
            rfq: {
              include: {
                items: true,
              },
            },
          },
        });

        if (!award) {
          throw new NotFoundException('Award not found');
        }

        if (award.supplierId !== supplierId) {
          throw new BadRequestException('You can only upload photos for your own awards');
        }

        rfqId = award.rfqId;
        rfqDataForPhoto = award.rfq;
      }

      // 检查 rfqItem 是否属于该询价单
      const rfqItem = rfqDataForPhoto.items.find(item => item.id === rfqItemId);
      if (!rfqItem) {
        throw new BadRequestException('RFQ item not found in this RFQ');
      }

      // 上传文件到 MinIO
      // 注意：uploadFile 返回的是签名 URL，但我们应该存储文件 key，以便后续可以重新生成签名 URL
      let fileKey: string;
      let fileUrl: string;
      try {
        // 先上传文件获取签名 URL
        fileUrl = await this.storageService.uploadFile(file, 'shipment-photos');
        this.logger.debug('文件上传成功', { fileUrl });
        
        // 从签名 URL 中提取文件 key（用于存储到数据库）
        // URL 格式：http://localhost:9000/eggpurchase/shipment-photos/...?X-Amz-...
        try {
          const url = new URL(fileUrl);
          let keyFromUrl = url.pathname.substring(1); // 移除前导斜杠
          // 移除 bucket 名称前缀
          if (keyFromUrl.startsWith('eggpurchase/')) {
            keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
          }
          fileKey = keyFromUrl;
          this.logger.debug('从 URL 提取文件 key', { fileKey });
        } catch (urlError) {
          // 如果无法解析 URL，使用完整 URL 作为 key（向后兼容）
          this.logger.warn('无法从 URL 提取 key，使用完整 URL', { urlError });
          fileKey = fileUrl;
        }
      } catch (uploadError: any) {
        this.logger.error('文件上传失败', { uploadError });
        throw new BadRequestException(`文件上传失败: ${uploadError.message || 'MinIO 连接失败，请检查 MinIO 服务是否运行'}`);
      }

      // 如果是虚拟 Award ID，需要找到或创建真实的 Award 记录
      let realAwardId = awardId;
      if (awardId.startsWith('virtual-')) {
        // 从虚拟 ID 中提取 rfqId 和 supplierId
        const prefix = 'virtual-';
        const idWithoutPrefix = awardId.substring(prefix.length);
        const lastDashIndex = idWithoutPrefix.lastIndexOf('-');
        
        if (lastDashIndex === -1 || lastDashIndex === 0 || lastDashIndex === idWithoutPrefix.length - 1) {
          throw new BadRequestException('Invalid virtual award ID format');
        }
        
        const rfqIdFromId = idWithoutPrefix.substring(0, lastDashIndex);
        const supplierIdFromId = idWithoutPrefix.substring(lastDashIndex + 1);
        
        // 查找是否已有真实的 Award 记录（通过 rfqId 和 supplierId 查找，使用复合唯一约束）
        let existingAward = null;
        try {
          existingAward = await this.prisma.award.findUnique({
            where: {
              rfqId_supplierId: {
                rfqId: rfqIdFromId,
                supplierId: supplierIdFromId,
              },
            },
          });
        } catch (error) {
          // 如果找不到，继续创建
          this.logger.debug('未找到现有的 Award 记录，将创建新的');
        }

        if (existingAward) {
          realAwardId = existingAward.id;
          this.logger.debug('找到现有的 Award 记录', { realAwardId });
        } else {
          // 如果没有真实的 Award 记录，尝试创建一个
          // 注意：由于 rfqId 是唯一的，如果已经有其他供应商的 Award，创建会失败
          // 在这种情况下，我们应该使用现有的 Award（即使供应商不同）
          // 或者，我们可以查找是否有任何 Award 记录
          try {
            const awardedItems = await this.prisma.rfqItem.findMany({
              where: {
                rfqId: rfqIdFromId,
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

            let totalPrice = 0;
            let firstQuoteId = '';
            for (const item of awardedItems) {
              if (item.quoteItems && item.quoteItems.length > 0) {
                // 找到该供应商的报价项（价格最低的）
                const supplierQuoteItems = item.quoteItems.filter(
                  qi => qi.quote.supplierId === supplierId
                );
                if (supplierQuoteItems.length > 0) {
                  const bestQuoteItem = supplierQuoteItems.reduce((best, current) => {
                    const bestPrice = parseFloat(best.price.toString());
                    const currentPrice = parseFloat(current.price.toString());
                    return currentPrice < bestPrice ? current : best;
                  });
                  totalPrice += parseFloat(bestQuoteItem.price.toString()) * (item.quantity || 1);
                  if (!firstQuoteId) {
                    firstQuoteId = bestQuoteItem.quote.id;
                  }
                }
              }
            }

            if (firstQuoteId) {
              // 尝试创建 Award，如果失败（因为唯一约束），则查找现有的
              try {
                const newAward = await this.prisma.award.create({
                  data: {
                    rfqId: rfqIdFromId,
                    quoteId: firstQuoteId,
                    supplierId: supplierIdFromId,
                    finalPrice: totalPrice,
                    reason: `按商品级别选商，共 ${awardedItems.length} 个商品`,
                  },
                });
                realAwardId = newAward.id;
                this.logger.log('创建了真实的 Award 记录', { realAwardId });

                // ⚠️ 重要：更新 quote.status 和 quote.price
                await this.prisma.quote.update({
                  where: { id: firstQuoteId },
                  data: {
                    status: 'AWARDED',
                    price: totalPrice, // 更新 price，只包含真正中标的商品
                  },
                });
                this.logger.log('已更新 quote.status 和 quote.price', {
                  quoteId: firstQuoteId,
                  status: 'AWARDED',
                  price: totalPrice,
                });
              } catch (createError: any) {
                // 如果创建失败（可能是因为唯一约束），再次查找现有的 Award
                if (createError.code === 'P2002') {
                  this.logger.debug('创建 Award 失败（唯一约束），查找现有的 Award...');
                  const existingAwardRetry = await this.prisma.award.findUnique({
                    where: {
                      rfqId_supplierId: {
                        rfqId: rfqIdFromId,
                        supplierId: supplierIdFromId,
                      },
                    },
                  });
                  if (existingAwardRetry) {
                    realAwardId = existingAwardRetry.id;
                    this.logger.debug('使用现有的 Award 记录', { realAwardId });
                  } else {
                    throw createError;
                  }
                } else {
                  throw createError;
                }
              }
            } else {
              throw new BadRequestException('Cannot create award: no quote found for this supplier');
            }
          } catch (error: any) {
            // 如果创建失败，尝试再次查找现有的 Award
            if (error.code !== 'P2002') {
              const existingAwardRetry = await this.prisma.award.findUnique({
                where: {
                  rfqId_supplierId: {
                    rfqId,
                    supplierId: supplierIdFromId,
                  },
                },
              });
              if (existingAwardRetry) {
                realAwardId = existingAwardRetry.id;
                this.logger.debug('使用现有的 Award 记录', { realAwardId });
              } else {
                throw error;
              }
            } else {
              throw error;
            }
          }
        }
      }

      // 查找发货单（上传发货照片时，不自动创建发货单）
      // 如果用户想上传发货照片，应该先上传物流面单或手动输入运单号
      let shipment = await this.prisma.shipment.findFirst({
        where: {
          awardId: realAwardId,
          rfqItemId,
        },
      });

      if (!shipment) {
        // 上传发货照片时，如果没有发货单，不自动创建
        // 提示用户先上传物流面单或手动输入运单号
        throw new BadRequestException('请先上传物流面单或手动输入运单号，然后再上传发货照片');
      } else {
        this.logger.debug('使用现有发货单', { shipmentId: shipment.id });
      }

      // 创建或更新包裹记录（用于存储照片/视频）
      let packageRecord = await this.prisma.package.findFirst({
        where: {
          shipmentId: shipment.id,
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (!packageRecord) {
        this.logger.debug('创建新包裹记录');
        packageRecord = await this.prisma.package.create({
          data: {
            shipmentId: shipment.id,
            packageNo: `PKG-${Date.now()}`,
            photos: [fileKey], // 存储文件 key 而不是完整 URL
          },
        });
        this.logger.debug('包裹记录创建成功', { packageId: packageRecord.id });
      } else {
        this.logger.debug('更新现有包裹记录', { packageId: packageRecord.id });
        // 追加照片到现有包裹
        // photos 是 Json 类型，需要类型断言
        const existingPhotos = Array.isArray(packageRecord.photos) 
          ? (packageRecord.photos as string[])
          : [];
        const updatedPhotos = [...existingPhotos, fileKey];
        packageRecord = await this.prisma.package.update({
          where: { id: packageRecord.id },
          data: {
            photos: updatedPhotos as any, // 存储文件 key 而不是完整 URL
          },
        });
        const photosArray = Array.isArray(packageRecord.photos) 
          ? (packageRecord.photos as string[])
          : [];
        this.logger.debug('包裹记录更新成功', { photosCount: photosArray.length });
      }

      return {
        shipment,
        package: packageRecord,
        photoUrl: fileUrl,
      };
    } catch (error: any) {
      this.logger.error('uploadShipmentPhotos 错误', { error });
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`上传发货照片/视频失败: ${error.message || '未知错误'}`);
    }
  }

  /**
   * 供应商标记缺货
   */
  async markOutOfStock(awardId: string, supplierId: string, reason: string, rfqItemId?: string) {
    try {
      const award = await this.prisma.award.findUnique({
        where: { id: awardId },
        include: {
          rfq: {
            include: {
              items: true,
              buyer: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          supplier: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      if (!award || award.supplierId !== supplierId) {
        throw new NotFoundException('Award not found or unauthorized');
      }

      if (award.status !== 'ACTIVE') {
        throw new BadRequestException('只能标记有效的中标记录为缺货');
      }

      // 如果指定了商品ID，只标记该商品缺货
      if (rfqItemId) {
        const rfqItem = award.rfq.items.find(item => item.id === rfqItemId);
        if (!rfqItem) {
          throw new BadRequestException('RFQ item not found in this RFQ');
        }

        // 更新商品状态
        await this.prisma.rfqItem.update({
          where: { id: rfqItemId },
          data: {
            itemStatus: 'OUT_OF_STOCK',
            exceptionReason: reason,
            exceptionAt: new Date(),
          },
        });

        // 如果所有商品都缺货，更新中标状态
        const allItemsOutOfStock = award.rfq.items.every(item => 
          item.id === rfqItemId || item.itemStatus === 'OUT_OF_STOCK'
        );

        if (allItemsOutOfStock) {
          await this.prisma.award.update({
            where: { id: awardId },
            data: {
              status: 'OUT_OF_STOCK',
            },
          });
        }
      } else {
        // 标记整个中标为缺货
        await this.prisma.award.update({
          where: { id: awardId },
          data: {
            status: 'OUT_OF_STOCK',
          },
        });

        // 更新所有商品状态
        await this.prisma.rfqItem.updateMany({
          where: {
            rfqId: award.rfqId,
            itemStatus: { not: 'SHIPPED' }, // 已发货的不更新
          },
          data: {
            itemStatus: 'OUT_OF_STOCK',
            exceptionReason: reason,
            exceptionAt: new Date(),
          },
        });
      }

      // 记录审计日志
      await this.auditService.log({
        action: 'MARK_OUT_OF_STOCK',
        resource: 'Award',
        resourceId: awardId,
        userId: supplierId,
        details: { reason, rfqItemId },
      });

      // 发送通知给采购员（包含快速操作链接）
      await this.notificationQueue.addNotificationJob({
        userId: award.rfq.buyerId,
        type: 'AWARD_NOTIFICATION',
        title: '供应商缺货通知',
        content: `供应商 ${award.supplier.username} 标记询价单 ${award.rfq.rfqNo} 为缺货。原因：${reason}\n\n您可以选择：\n1. 重新发询价单\n2. 转为电商平台采购`,
        link: `/shipments?awardId=${awardId}`,
      });

      return { message: '已标记为缺货', awardId };
    } catch (error: any) {
      this.logger.error('markOutOfStock 错误', { error });
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      // 如果是 Prisma 错误，提供更友好的错误信息
      if (error.code === 'P2002' || error.message?.includes('column') || error.message?.includes('does not exist')) {
        throw new BadRequestException('数据库字段错误，请确保已运行数据库迁移并重新生成 Prisma Client');
      }
      throw new BadRequestException(`标记缺货失败: ${error.message || '未知错误'}`);
    }
  }

  /**
   * 采购员取消中标
   */
  async cancelAward(awardId: string, userId: string, reason: string, action: 'CANCEL' | 'SWITCH_TO_ECOMMERCE' | 'REASSIGN') {
    const award = await this.prisma.award.findUnique({
      where: { id: awardId },
      include: {
        rfq: {
          include: {
            items: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    if (!award) {
      throw new NotFoundException('Award not found');
    }

    if (award.status !== 'ACTIVE' && award.status !== 'OUT_OF_STOCK') {
      throw new BadRequestException('只能取消有效或缺货的中标记录');
    }

    // 更新中标状态
    await this.prisma.award.update({
      where: { id: awardId },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason,
        cancelledAt: new Date(),
        cancelledBy: userId,
      },
    });

    // 根据操作类型处理商品
    if (action === 'SWITCH_TO_ECOMMERCE') {
      // 改为电商采购
      await this.prisma.rfqItem.updateMany({
        where: {
          rfqId: award.rfqId,
          itemStatus: { not: 'SHIPPED' },
        },
        data: {
          itemStatus: 'ECOMMERCE_PENDING',
          source: 'ECOMMERCE',
          exceptionReason: reason,
          exceptionAt: new Date(),
        },
      });
    } else if (action === 'REASSIGN') {
      // 重新分配（重置状态，允许重新报价）
      await this.prisma.rfqItem.updateMany({
        where: {
          rfqId: award.rfqId,
          itemStatus: { not: 'SHIPPED' },
        },
        data: {
          itemStatus: 'PENDING',
          source: null,
          exceptionReason: reason,
          exceptionAt: new Date(),
        },
      });

      // 将报价状态重置为 REJECTED，允许重新报价
      await this.prisma.quote.update({
        where: { id: award.quoteId },
        data: {
          status: 'REJECTED',
        },
      });
    } else {
      // 直接取消
      await this.prisma.rfqItem.updateMany({
        where: {
          rfqId: award.rfqId,
          itemStatus: { not: 'SHIPPED' },
        },
        data: {
          itemStatus: 'CANCELLED',
          exceptionReason: reason,
          exceptionAt: new Date(),
        },
      });
    }

    // 记录审计日志
    await this.auditService.log({
      action: 'CANCEL_AWARD',
      resource: 'Award',
      resourceId: awardId,
      userId,
      details: { reason, action },
    });

    // 发送通知给供应商
    await this.notificationQueue.addNotificationJob({
      userId: award.supplierId,
      type: 'AWARD_CANCELLED',
      title: '中标取消通知',
      content: `询价单 ${award.rfq.rfqNo} 的中标已被取消。原因：${reason}`,
      link: `/quotes`,
    });

    return { message: '中标已取消', awardId, action };
  }

  /**
   * 更新电商采购状态
   */
  async updateEcommerceStatus(rfqItemId: string, status: 'ECOMMERCE_PENDING' | 'ECOMMERCE_PAID' | 'ECOMMERCE_SHIPPED', userId: string) {
    const rfqItem = await this.prisma.rfqItem.findUnique({
      where: { id: rfqItemId },
      include: {
        rfq: true,
      },
    });

    if (!rfqItem) {
      throw new NotFoundException('RFQ item not found');
    }

    if (rfqItem.source !== 'ECOMMERCE') {
      throw new BadRequestException('该商品不是电商采购');
    }

    await this.prisma.rfqItem.update({
      where: { id: rfqItemId },
      data: {
        itemStatus: status,
        updatedAt: new Date(),
      },
    });

    // 记录审计日志
    await this.auditService.log({
      action: 'UPDATE_ECOMMERCE_STATUS',
      resource: 'RfqItem',
      resourceId: rfqItemId,
      userId,
      details: { status },
    });

    return { message: '状态已更新', rfqItemId, status };
  }

  /**
   * 基于缺货的中标重新创建询价单
   */
  async recreateRfqFromOutOfStock(awardId: string, userId: string, deadline?: Date) {
    const award = await this.prisma.award.findUnique({
      where: { id: awardId },
      include: {
        rfq: {
          include: {
            items: {
              where: {
                itemStatus: 'OUT_OF_STOCK',
              },
            },
            store: true,
          },
        },
        supplier: {
          select: {
            username: true,
          },
        },
      },
    });

    if (!award) {
      throw new NotFoundException('Award not found');
    }

    if (award.status !== 'OUT_OF_STOCK') {
      throw new BadRequestException('只能基于缺货的中标重新创建询价单');
    }

    const outOfStockItems = award.rfq.items.filter(item => item.itemStatus === 'OUT_OF_STOCK');
    if (outOfStockItems.length === 0) {
      throw new BadRequestException('没有缺货的商品');
    }

    // 创建新的询价单
    const newDeadline = deadline || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 默认7天后截止
    const newRfq = await this.prisma.rfq.create({
      data: {
        rfqNo: `RFQ-${Date.now()}`,
        title: `重新询价-${award.rfq.title}`,
        description: `基于询价单 ${award.rfq.rfqNo} 重新询价（供应商 ${award.supplier.username} 缺货）`,
        type: award.rfq.type,
        status: 'PUBLISHED',
        deadline: newDeadline,
        buyerId: userId,
        storeId: award.rfq.storeId,
      },
    });

    // 创建询价单商品（只包含缺货的商品）
    await this.prisma.rfqItem.createMany({
      data: outOfStockItems.map(item => ({
        rfqId: newRfq.id,
        productName: item.productName,
        quantity: item.quantity,
        unit: item.unit,
        description: item.description,
        notes: item.notes || `原询价单: ${award.rfq.rfqNo}`,
        orderNo: item.orderNo,
        itemStatus: 'PENDING',
      })),
    });

    // 记录审计日志
    await this.auditService.log({
      action: 'RECREATE_RFQ_FROM_OUT_OF_STOCK',
      resource: 'Rfq',
      resourceId: newRfq.id,
      userId,
      details: { originalAwardId: awardId, originalRfqId: award.rfqId },
    });

    // 发送通知给供应商
    await this.notificationQueue.addNotificationJob({
      userId: award.supplierId,
      type: 'RFQ_CREATED',
      title: '重新询价通知',
      content: `询价单 ${award.rfq.rfqNo} 因缺货已重新发布为新询价单 ${newRfq.rfqNo}，请及时报价`,
      link: `/quotes`,
    });

    return { message: '询价单已重新创建', rfqId: newRfq.id, rfqNo: newRfq.rfqNo };
  }

  /**
   * 将缺货商品转为电商平台采购
   */
  async convertToEcommerce(awardId: string, userId: string, rfqItemIds?: string[]) {
    const award = await this.prisma.award.findUnique({
      where: { id: awardId },
      include: {
        rfq: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!award) {
      throw new NotFoundException('Award not found');
    }

    if (award.status !== 'OUT_OF_STOCK') {
      throw new BadRequestException('只能将缺货的中标转为电商采购');
    }

    // 确定要转换的商品
    const itemsToConvert = rfqItemIds 
      ? award.rfq.items.filter(item => rfqItemIds.includes(item.id) && item.itemStatus === 'OUT_OF_STOCK')
      : award.rfq.items.filter(item => item.itemStatus === 'OUT_OF_STOCK');

    if (itemsToConvert.length === 0) {
      throw new BadRequestException('没有可转换的缺货商品');
    }

    // 更新商品状态为电商采购待付款
    await this.prisma.rfqItem.updateMany({
      where: {
        id: { in: itemsToConvert.map(item => item.id) },
        itemStatus: 'OUT_OF_STOCK',
      },
      data: {
        itemStatus: 'ECOMMERCE_PENDING',
        source: 'ECOMMERCE',
        exceptionReason: `已转为电商平台采购（原供应商缺货）`,
        exceptionAt: new Date(),
      },
    });

    // 如果所有缺货商品都已转换，更新中标状态
    const remainingOutOfStock = award.rfq.items.filter(
      item => item.itemStatus === 'OUT_OF_STOCK' && !itemsToConvert.find(i => i.id === item.id)
    );

    if (remainingOutOfStock.length === 0) {
      // 所有缺货商品都已处理，可以取消中标或保持状态
      // 这里我们保持 OUT_OF_STOCK 状态，因为可能还有其他商品
    }

    // 记录审计日志
    await this.auditService.log({
      action: 'CONVERT_TO_ECOMMERCE',
      resource: 'Award',
      resourceId: awardId,
      userId,
      details: { rfqItemIds: itemsToConvert.map(item => item.id) },
    });

    // 发送通知给供应商
    await this.notificationQueue.addNotificationJob({
      userId: award.supplierId,
      type: 'AWARD_CANCELLED',
      title: '转为电商采购通知',
      content: `询价单 ${award.rfq.rfqNo} 的缺货商品已转为电商平台采购`,
      link: `/quotes`,
    });

    return { 
      message: '已转为电商平台采购', 
      awardId,
      convertedItems: itemsToConvert.map(item => ({
        id: item.id,
        productName: item.productName,
        quantity: item.quantity,
      })),
    };
  }
}


