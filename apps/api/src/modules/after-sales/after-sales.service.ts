import { Injectable, BadRequestException, NotFoundException, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAfterSalesDto } from './dto/create-after-sales.dto';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { NotificationService } from '../notification/notification.service';
import { ShipmentService } from '../shipment/shipment.service';

const TYPE_LABELS: Record<string, string> = {
  DAMAGED: '盒损',
  MISSING: '掉件',
  WRONG_ITEM: '错发',
  REPAIR: '换货',
  CLAIM: '补差价',
  DISCOUNT: '二手充新',
  SCRAP: '报废',
};

const PRIORITY_LABELS: Record<string, string> = {
  LOW: '低',
  MEDIUM: '中',
  HIGH: '高',
  URGENT: '紧急',
};

@Injectable()
export class AfterSalesService {
  private readonly logger = new Logger(AfterSalesService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private storageService: StorageService,
    private notificationService: NotificationService,
    private shipmentService: ShipmentService,
  ) {}

  async create(createAfterSalesDto: CreateAfterSalesDto, userId?: string) {
    try {
      // 验证必填字段
      if (!createAfterSalesDto.description || createAfterSalesDto.description.trim() === '') {
        throw new BadRequestException('问题描述不能为空');
      }
      if (!createAfterSalesDto.type) {
        throw new BadRequestException('售后类型不能为空');
      }
      if (!createAfterSalesDto.priority) {
        throw new BadRequestException('优先级不能为空');
      }

      const caseNo = `RMA-${Date.now()}`;
      
      // 如果提供了快递单号，自动定位供应商或电商平台
      let shipmentId = createAfterSalesDto.shipmentId;
      let supplierId = createAfterSalesDto.supplierId;
      let orderId = createAfterSalesDto.orderId;
      let storeId = createAfterSalesDto.storeId;
      let source: 'SUPPLIER' | 'ECOMMERCE' | null = null; // 记录发货来源

    if (createAfterSalesDto.trackingNo && !shipmentId) {
      // 通过快递单号查找发货单（使用 findFirst，因为 trackingNo 不再是唯一字段）
      const shipment = await this.prisma.shipment.findFirst({
        where: { trackingNo: createAfterSalesDto.trackingNo },
        include: {
          supplier: {
            select: {
              id: true,
              username: true,
            },
          },
          order: {
            select: {
              id: true,
              storeId: true,
            },
          },
          rfqItem: {
            include: {
              rfq: {
                include: {
                  store: {
                    select: {
                      id: true,
                    },
                  },
                  orders: {
                    include: {
                      order: {
                        select: {
                          id: true,
                          storeId: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (shipment) {
        shipmentId = shipment.id;
        source = shipment.source; // 记录发货来源
        supplierId = shipment.supplierId || undefined;
        
        // 如果是供应商发货，设置供应商ID
        if (shipment.source === 'SUPPLIER' && shipment.supplierId) {
          supplierId = shipment.supplierId;
        }
        
        // 如果是电商平台采购，supplierId 为 null
        if (shipment.source === 'ECOMMERCE') {
          supplierId = null;
        }

        // 从 rfqItem 关联的订单中获取 orderId 和 storeId
        if (shipment.rfqItem?.rfq?.orders && shipment.rfqItem.rfq.orders.length > 0) {
          orderId = shipment.rfqItem.rfq.orders[0].orderId;
          // 优先从订单获取门店，如果没有则从询价单获取
          if (shipment.rfqItem.rfq.orders[0].order?.storeId) {
            storeId = shipment.rfqItem.rfq.orders[0].order.storeId;
          } else if (shipment.rfqItem.rfq.store?.id) {
            storeId = shipment.rfqItem.rfq.store.id;
          }
        } else if (shipment.rfqItem?.rfq?.store?.id) {
          // 如果询价单有门店，使用询价单的门店
          storeId = shipment.rfqItem.rfq.store.id;
        } else if (shipment.order?.storeId) {
          // 如果发货单直接关联订单，从订单获取门店
          storeId = shipment.order.storeId;
        }
      } else {
        // 如果 Shipment 中没有找到，尝试从 RFQItem 查找（电商平台采购）
        const rfqItem = await this.prisma.rfqItem.findFirst({
          where: {
            trackingNo: createAfterSalesDto.trackingNo,
            source: 'ECOMMERCE',
          },
          include: {
            rfq: {
              include: {
                store: {
                  select: {
                    id: true,
                  },
                },
                orders: {
                  include: {
                    order: {
                      select: {
                        id: true,
                        storeId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        });

        if (rfqItem) {
          // 电商平台采购没有 Shipment 记录，shipmentId 为 null
          shipmentId = null;
          supplierId = null; // 电商平台采购没有供应商
          source = 'ECOMMERCE'; // 记录为电商平台采购
          
          // 从 rfqItem 关联的订单中获取 orderId 和 storeId
          if (rfqItem.rfq.orders && rfqItem.rfq.orders.length > 0) {
            orderId = rfqItem.rfq.orders[0].orderId;
            // 优先从订单获取门店，如果没有则从询价单获取
            if (rfqItem.rfq.orders[0].order?.storeId) {
              storeId = rfqItem.rfq.orders[0].order.storeId;
            } else if (rfqItem.rfq.store?.id) {
              storeId = rfqItem.rfq.store.id;
            }
          } else if (rfqItem.rfq.store?.id) {
            // 如果询价单有门店，使用询价单的门店
            storeId = rfqItem.rfq.store.id;
          }
        }
      }
    }

    // 如果没有从快递单号获取到门店，尝试从订单获取
    if (!storeId && orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: { storeId: true },
      });
      if (order?.storeId) {
        storeId = order.storeId;
      }
    }

    // 如果还没有确定来源，且提供了 shipmentId，从 shipment 获取
    if (!source && shipmentId) {
      const shipmentInfo = await this.prisma.shipment.findUnique({
        where: { id: shipmentId },
        select: { source: true, supplierId: true },
      });
      if (shipmentInfo) {
        source = shipmentInfo.source;
        if (source === 'SUPPLIER' && shipmentInfo.supplierId && !supplierId) {
          supplierId = shipmentInfo.supplierId;
        }
      }
    }

    // 如果还没有确定来源，且提供了 orderId，尝试从订单关联的询价单或发货单推断
    if (!source && orderId) {
      // 先查找订单关联的发货单
      const orderShipment = await this.prisma.shipment.findFirst({
        where: { orderId },
        select: { source: true, supplierId: true },
        orderBy: { createdAt: 'desc' },
      });
      
      if (orderShipment) {
        source = orderShipment.source;
        if (source === 'SUPPLIER' && orderShipment.supplierId && !supplierId) {
          supplierId = orderShipment.supplierId;
        }
      } else {
        // 如果没有发货单，查找订单关联的询价单商品（可能是电商采购）
        const orderRfq = await this.prisma.orderRfq.findFirst({
          where: { orderId },
          include: {
            rfq: {
              include: {
                items: {
                  where: {
                    source: 'ECOMMERCE',
                    trackingNo: { not: null },
                  },
                  take: 1,
                },
              },
            },
          },
        });
        
        if (orderRfq?.rfq?.items && orderRfq.rfq.items.length > 0) {
          source = 'ECOMMERCE';
        }
      }
    }

    // 如果提供了 storeId，验证门店是否存在
    if (storeId) {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { id: true },
      });
      if (!store) {
        throw new BadRequestException(`门店不存在：${storeId}`);
      }
    }
    
    // 计算 SLA 截止时间（根据优先级）
    const slaDeadline = this.calculateSLADeadline(createAfterSalesDto.priority);

    // 清理空字符串，转换为 null 或 undefined
    // supplierId: 如果 supplierId 已设置（不为 null/undefined），使用它；否则检查 DTO 中的值
    const cleanSupplierId = supplierId !== undefined && supplierId !== null 
      ? supplierId 
      : (createAfterSalesDto.supplierId?.trim() || null);
    
    // claimAmount: 如果是字符串，尝试转换为数字；如果是数字，直接使用；否则为 null
    // 注意：前端可能发送字符串，但 DTO 定义为 number，所以需要类型检查
    let cleanClaimAmount: number | null = null;
    const claimAmountValue = createAfterSalesDto.claimAmount as any; // 允许字符串或数字
    if (claimAmountValue !== undefined && claimAmountValue !== null) {
      if (typeof claimAmountValue === 'string') {
        const trimmed = claimAmountValue.trim();
        if (trimmed) {
          const parsed = parseFloat(trimmed);
          cleanClaimAmount = isNaN(parsed) ? null : parsed;
        }
      } else if (typeof claimAmountValue === 'number') {
        cleanClaimAmount = claimAmountValue;
      }
    }
    
    // 其他可选字段：空字符串转换为 null
    const cleanInventoryDisposition = createAfterSalesDto.inventoryDisposition?.trim() || null;
    const cleanCustomerId = createAfterSalesDto.customerId?.trim() || null;

    const afterSales = await this.prisma.afterSalesCase.create({
      data: {
        caseNo,
        orderId: orderId || createAfterSalesDto.orderId,
        shipmentId: shipmentId || null,
        storeId: storeId || null,
        type: createAfterSalesDto.type as any,
        priority: createAfterSalesDto.priority as any,
        description: createAfterSalesDto.description,
        customerId: cleanCustomerId,
        supplierId: cleanSupplierId,
        claimAmount: cleanClaimAmount,
        inventoryDisposition: cleanInventoryDisposition,
        handlerId: userId,
        slaDeadline,
      },
      include: {
        order: true,
        store: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        shipment: {
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
    });

    // 记录日志
    await this.prisma.afterSalesLog.create({
      data: {
        caseId: afterSales.id,
        action: 'OPENED',
        description: '售后工单已创建',
        userId,
      },
    });

    // 根据发货来源自动分配工单
    let finalAfterSales = afterSales;

    // 如果是供应商发货，自动下发给供应商
    if (source === 'SUPPLIER' && cleanSupplierId) {
      try {
        finalAfterSales = await this.prisma.afterSalesCase.update({
          where: { id: afterSales.id },
          data: {
            supplierId: cleanSupplierId,
            status: 'EXECUTING', // 自动改为执行中状态
          },
          include: {
            order: true,
            store: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            shipment: {
              include: {
                supplier: {
                  select: {
                    id: true,
                    username: true,
                  },
                },
              },
            },
            replacementShipment: {
              include: {
                supplier: {
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
            handler: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        });

        // 查询供应商信息（用于日志和通知）
        const supplier = await this.prisma.user.findUnique({
          where: { id: cleanSupplierId },
          select: { id: true, username: true },
        });

        // 记录自动下发日志
        await this.prisma.afterSalesLog.create({
          data: {
            caseId: afterSales.id,
            action: 'EXECUTING',
            description: `工单已自动下发给供应商：${supplier?.username || cleanSupplierId}`,
            userId: userId || 'SYSTEM',
          },
        });

        // 发送通知给供应商
        try {
          if (supplier) {
            // 获取类型和优先级的显示名称
            const typeLabel = TYPE_LABELS[createAfterSalesDto.type] || createAfterSalesDto.type;
            const priorityLabel = PRIORITY_LABELS[createAfterSalesDto.priority] || createAfterSalesDto.priority;

            await this.notificationService.create({
              userId: supplier.id,
              type: 'AFTERSALES_ALERT',
              title: '新售后工单通知',
              content: `您有一个新的售后工单 ${afterSales.caseNo}，类型：${typeLabel}，优先级：${priorityLabel}，请及时处理`,
              link: `/after-sales/${afterSales.id}`,
              userName: supplier.username || undefined,
            });

            this.logger.log('已发送售后工单通知给供应商', {
              caseNo: afterSales.caseNo,
              supplierId: cleanSupplierId,
              supplierName: supplier.username,
            });
          }
        } catch (notifyError) {
          const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
          this.logger.warn('发送供应商通知失败', {
            caseId: afterSales.id,
            supplierId: cleanSupplierId,
            error: errorMessage,
          });
          // 通知失败不影响主流程
        }

        this.logger.log('售后工单已自动下发给供应商', {
          caseNo: afterSales.caseNo,
          supplierId: cleanSupplierId,
          supplierName: supplier?.username,
        });
      } catch (assignError) {
        const errorMessage = assignError instanceof Error ? assignError.message : String(assignError);
        this.logger.error('自动下发给供应商失败', {
          caseId: afterSales.id,
          supplierId: cleanSupplierId,
          error: errorMessage,
        });
        // 自动分配失败不影响工单创建，继续使用原始工单
      }
    }
    // 如果是电商平台采购，下发给采购员
    else if (source === 'ECOMMERCE') {
      try {
        // 查找采购员：优先从询价单的 buyerId 获取
        let buyerId: string | null = null;
        
        if (shipmentId) {
          const shipmentInfo = await this.prisma.shipment.findUnique({
            where: { id: shipmentId },
            include: {
              rfqItem: {
                include: {
                  rfq: {
                    select: {
                      buyerId: true,
                      buyer: {
                        select: {
                          id: true,
                          role: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          });
          
          if (shipmentInfo?.rfqItem?.rfq?.buyerId) {
            const buyer = shipmentInfo.rfqItem.rfq.buyer;
            // 如果 buyer 是采购员，使用 buyerId；如果是管理员，需要找其他采购员
            if (buyer && buyer.role === 'BUYER') {
              buyerId = shipmentInfo.rfqItem.rfq.buyerId;
            } else if (buyer && buyer.role === 'ADMIN') {
              // 如果是管理员创建的，找第一个采购员
              const buyers = await this.prisma.user.findMany({
                where: { role: 'BUYER', status: 'ACTIVE' },
                select: { id: true },
                take: 1,
              });
              if (buyers.length > 0) {
                buyerId = buyers[0].id;
              }
            }
          }
        }
        
        // 如果还没找到采购员，从订单关联的询价单获取
        if (!buyerId && orderId) {
          const orderRfq = await this.prisma.orderRfq.findFirst({
            where: { orderId },
            include: {
              rfq: {
                select: {
                  buyerId: true,
                  buyer: {
                    select: {
                      id: true,
                      role: true,
                    },
                  },
                },
              },
            },
          });
          
          if (orderRfq?.rfq?.buyerId) {
            const buyer = orderRfq.rfq.buyer;
            if (buyer && buyer.role === 'BUYER') {
              buyerId = orderRfq.rfq.buyerId;
            } else if (buyer && buyer.role === 'ADMIN') {
              // 如果是管理员创建的，找第一个采购员
              const buyers = await this.prisma.user.findMany({
                where: { role: 'BUYER', status: 'ACTIVE' },
                select: { id: true },
                take: 1,
              });
              if (buyers.length > 0) {
                buyerId = buyers[0].id;
              }
            }
          }
        }
        
        // 如果还是没找到，找第一个采购员
        if (!buyerId) {
          const buyers = await this.prisma.user.findMany({
            where: { role: 'BUYER', status: 'ACTIVE' },
            select: { id: true },
            take: 1,
          });
          if (buyers.length > 0) {
            buyerId = buyers[0].id;
          }
        }

        // 如果找到了采购员，更新工单的 handlerId
        if (buyerId) {
          // 查询采购员信息（用于日志）
          const buyer = await this.prisma.user.findUnique({
            where: { id: buyerId },
            select: { id: true, username: true },
          });

          finalAfterSales = await this.prisma.afterSalesCase.update({
            where: { id: afterSales.id },
            data: {
              handlerId: buyerId, // 将处理人设置为采购员
            },
            include: {
              order: true,
              store: {
                select: {
                  id: true,
                  name: true,
                  code: true,
                },
              },
              shipment: {
                include: {
                  supplier: {
                    select: {
                      id: true,
                      username: true,
                    },
                  },
                },
              },
              replacementShipment: {
                include: {
                  supplier: {
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
              handler: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          });

          // 记录自动分配日志
          await this.prisma.afterSalesLog.create({
            data: {
              caseId: afterSales.id,
              action: 'OPENED',
              description: `工单已自动分配给采购员：${buyer?.username || buyerId}`,
              userId: userId || 'SYSTEM',
            },
          });

          this.logger.log('售后工单已自动分配给采购员', {
            caseNo: afterSales.caseNo,
            buyerId,
            buyerName: buyer?.username,
          });
        } else {
          this.logger.warn('未找到采购员，工单保持原处理人', {
            caseNo: afterSales.caseNo,
          });
        }
      } catch (assignError) {
        const errorMessage = assignError instanceof Error ? assignError.message : String(assignError);
        this.logger.error('自动分配给采购员失败', {
          caseId: afterSales.id,
          error: errorMessage,
        });
        // 自动分配失败不影响工单创建，继续使用原始工单
      }
    }

    // 如果工单关联了供应商，但还没有发送通知（非自动分配场景），发送通知
    // 注意：自动分配场景（source === 'SUPPLIER'）已经在上面发送过通知了
    if (finalAfterSales.supplierId && source !== 'SUPPLIER') {
      try {
        const supplier = await this.prisma.user.findUnique({
          where: { id: finalAfterSales.supplierId },
          select: { id: true, username: true },
        });

        if (supplier) {
          // 获取类型和优先级的显示名称
          const typeLabel = TYPE_LABELS[createAfterSalesDto.type] || createAfterSalesDto.type;
          const priorityLabel = PRIORITY_LABELS[createAfterSalesDto.priority] || createAfterSalesDto.priority;

          await this.notificationService.create({
            userId: supplier.id,
            type: 'AFTERSALES_ALERT',
            title: '新售后工单通知',
            content: `您有一个新的售后工单 ${finalAfterSales.caseNo}，类型：${typeLabel}，优先级：${priorityLabel}，请及时处理`,
            link: `/after-sales/${finalAfterSales.id}`,
            userName: supplier.username || undefined,
          });

          this.logger.log('已发送售后工单通知给供应商', {
            caseNo: finalAfterSales.caseNo,
            supplierId: finalAfterSales.supplierId,
            supplierName: supplier.username,
          });
        }
      } catch (notifyError) {
        const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
        this.logger.warn('发送供应商通知失败', {
          caseId: finalAfterSales.id,
          supplierId: finalAfterSales.supplierId,
          error: errorMessage,
        });
        // 通知失败不影响主流程
      }
    }

    // 记录审计日志（失败不影响主流程）
    try {
      await this.auditService.log({
        action: 'aftersales.create',
        resource: 'AfterSalesCase',
        resourceId: finalAfterSales.id,
        userId,
      });
    } catch (auditError) {
      const errorMessage = auditError instanceof Error ? auditError.message : String(auditError);
      this.logger.warn('记录审计日志失败', {
        afterSalesId: finalAfterSales.id,
        userId,
        error: errorMessage,
      });
    }

    this.logger.log('售后工单创建成功', {
      caseNo: finalAfterSales.caseNo,
      orderId: finalAfterSales.orderId,
      storeId: finalAfterSales.storeId,
      source: source || '未知',
      supplierId: finalAfterSales.supplierId,
      handlerId: finalAfterSales.handlerId,
      status: finalAfterSales.status,
      userId,
    });

    return finalAfterSales;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('创建售后工单失败', {
        createAfterSalesDto: {
          orderId: createAfterSalesDto.orderId,
          trackingNo: createAfterSalesDto.trackingNo,
          type: createAfterSalesDto.type,
        },
        userId,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      // 如果是已知的业务异常，直接抛出
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      // 根据错误类型提供更具体的错误信息
      if (errorMessage.includes('Unique constraint') || errorMessage.includes('唯一约束')) {
        throw new BadRequestException('创建售后工单失败：工单号已存在');
      }
      if (errorMessage.includes('Foreign key') || errorMessage.includes('外键')) {
        throw new BadRequestException('创建售后工单失败：关联数据不存在，请检查订单、发货单或门店信息');
      }
      if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
        throw new InternalServerErrorException('数据库结构未更新，请运行数据库迁移：npx prisma migrate dev');
      }
      if (errorMessage.includes('Unknown column') || errorMessage.includes('storeId')) {
        throw new InternalServerErrorException('数据库结构未更新，请运行数据库迁移：npx prisma migrate dev');
      }

      throw new BadRequestException(`创建售后工单失败：${errorMessage}`);
    }
  }

  async updateStatus(id: string, status: string, userId?: string, description?: string) {
    const afterSales = await this.prisma.afterSalesCase.update({
      where: { id },
      data: { status: status as any },
    });

    await this.prisma.afterSalesLog.create({
      data: {
        caseId: id,
        action: status,
        description,
        userId,
      },
    });

    // 如果已解决，记录解决时间
    if (status === 'RESOLVED') {
      await this.prisma.afterSalesCase.update({
        where: { id },
        data: { resolvedAt: new Date() },
      });

      await this.auditService.log({
        action: 'aftersales.resolution',
        resource: 'AfterSalesCase',
        resourceId: id,
        userId,
      });
    }

    return afterSales;
  }

  /**
   * 下发工单给供应商（管理员/采购员使用）
   */
  async assignToSupplier(id: string, supplierId: string, userId?: string) {
    // 验证工单是否存在
    const afterSales = await this.prisma.afterSalesCase.findUnique({
      where: { id },
    });

    if (!afterSales) {
      throw new Error('售后工单不存在');
    }

    // 验证工单状态（只有 OPENED 状态的工单可以下发）
    if (afterSales.status !== 'OPENED') {
      throw new Error('只能下发状态为"已开启"的工单');
    }

    // 更新工单：设置供应商ID，状态改为 EXECUTING（执行中）
    const updated = await this.prisma.afterSalesCase.update({
      where: { id },
      data: {
        supplierId,
        status: 'EXECUTING',
      },
      include: {
        order: true,
        shipment: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        handler: {
          select: {
            id: true,
            username: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
        attachments: true,
        logs: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    // 记录日志
    await this.prisma.afterSalesLog.create({
      data: {
        caseId: id,
        action: 'EXECUTING',
        description: '工单已下发给供应商',
        userId,
      },
    });

    // 发送通知给供应商
    try {
      const supplier = await this.prisma.user.findUnique({
        where: { id: supplierId },
        select: { id: true, username: true },
      });

      if (supplier) {
        await this.notificationService.create({
          userId: supplier.id,
          type: 'AFTERSALES_ALERT',
          title: '新售后工单通知',
          content: `您有一个新的售后工单 ${updated.caseNo}，请及时处理`,
          link: `/after-sales/${id}`,
          userName: supplier.username || undefined,
        });

        this.logger.log('已发送售后工单通知给供应商', {
          caseNo: updated.caseNo,
          supplierId,
          supplierName: supplier.username,
        });
      }
    } catch (notifyError) {
      const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
      this.logger.warn('发送供应商通知失败', {
        caseId: id,
        supplierId,
        error: errorMessage,
      });
      // 通知失败不影响主流程
    }

    await this.auditService.log({
      action: 'aftersales.assign',
      resource: 'AfterSalesCase',
      resourceId: id,
      userId,
    });

    return updated;
  }

  /**
   * 供应商提交处理方案（供应商使用）
   */
  async submitResolution(id: string, resolution: string, userId?: string) {
    try {
      // 验证输入
      if (!resolution || !resolution.trim()) {
        throw new BadRequestException('处理方案不能为空');
      }

      // 验证工单是否存在
      const afterSales = await this.prisma.afterSalesCase.findUnique({
        where: { id },
        select: { supplierId: true, status: true, caseNo: true },
      });

      if (!afterSales) {
        throw new NotFoundException('售后工单不存在');
      }

      this.logger.log('提交处理方案请求', {
        caseId: id,
        caseNo: afterSales.caseNo,
        userId,
        supplierId: afterSales.supplierId,
        status: afterSales.status,
      });

      // 验证权限：供应商只能提交自己的工单
      if (userId && afterSales.supplierId && afterSales.supplierId !== userId) {
        this.logger.warn('权限验证失败', {
          caseId: id,
          userId,
          supplierId: afterSales.supplierId,
        });
        throw new BadRequestException('无权提交此售后工单的处理方案');
      }

      // 验证状态：只有 EXECUTING 状态的工单可以提交方案
      if (afterSales.status !== 'EXECUTING') {
        this.logger.warn('状态验证失败', {
          caseId: id,
          currentStatus: afterSales.status,
          requiredStatus: 'EXECUTING',
        });
        throw new BadRequestException(`只能提交状态为"执行中"的工单，当前状态：${afterSales.status}`);
      }

    // 更新工单：设置处理方案，状态改为 INSPECTING（待确认）
    const updated = await this.prisma.afterSalesCase.update({
      where: { id },
      data: {
        resolution,
        status: 'INSPECTING',
      },
      include: {
        order: true,
        shipment: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        handler: {
          select: {
            id: true,
            username: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
        attachments: true,
        logs: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    // 记录日志
    await this.prisma.afterSalesLog.create({
      data: {
        caseId: id,
        action: 'INSPECTING',
        description: '供应商已提交处理方案，等待管理员确认',
        userId,
      },
    });

      await this.auditService.log({
        action: 'aftersales.submit_resolution',
        resource: 'AfterSalesCase',
        resourceId: id,
        userId,
      });

      this.logger.log('处理方案提交成功', {
        caseId: id,
        caseNo: afterSales.caseNo,
        userId,
      });

      return updated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error('提交处理方案失败', {
        caseId: id,
        userId,
        resolution: resolution?.substring(0, 100), // 只记录前100个字符
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      // 如果是已知的业务异常，直接抛出
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new BadRequestException(`提交处理方案失败：${errorMessage}`);
    }
  }

  /**
   * 确认售后完成（管理员/采购员使用）
   */
  async confirmResolution(id: string, userId?: string, confirmed: boolean = true) {
    // 验证工单是否存在
    const afterSales = await this.prisma.afterSalesCase.findUnique({
      where: { id },
      select: { status: true },
    });

    if (!afterSales) {
      throw new Error('售后工单不存在');
    }

    // 验证状态：只有 INSPECTING 状态的工单可以确认
    if (afterSales.status !== 'INSPECTING') {
      throw new Error('只能确认状态为"待确认"的工单');
    }

    // 更新工单状态
    const newStatus = confirmed ? 'RESOLVED' : 'EXECUTING';
    const updated = await this.prisma.afterSalesCase.update({
      where: { id },
      data: {
        status: newStatus,
        ...(confirmed ? { resolvedAt: new Date() } : {}),
      },
      include: {
        order: true,
        shipment: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        handler: {
          select: {
            id: true,
            username: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
        attachments: true,
        logs: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    // 记录日志
    await this.prisma.afterSalesLog.create({
      data: {
        caseId: id,
        action: newStatus,
        description: confirmed ? '管理员已确认售后完成' : '管理员退回，需要供应商重新处理',
        userId,
      },
    });

    await this.auditService.log({
      action: 'aftersales.confirm',
      resource: 'AfterSalesCase',
      resourceId: id,
      userId,
    });

    return updated;
  }

  /**
   * 更新售后处理方案和进度（供应商使用，不改变状态）
   */
  async updateResolution(id: string, resolution?: string, progressDescription?: string, userId?: string) {
    // 验证权限：供应商只能更新自己的售后工单
    const afterSales = await this.prisma.afterSalesCase.findUnique({
      where: { id },
      select: { supplierId: true, status: true },
    });

    if (!afterSales) {
      throw new NotFoundException('售后工单不存在');
    }

    if (userId && afterSales.supplierId && afterSales.supplierId !== userId) {
      throw new BadRequestException('无权更新此售后工单');
    }

    // 验证状态：只有 EXECUTING 状态的工单可以更新方案（未提交前）
    if (afterSales.status !== 'EXECUTING') {
      throw new BadRequestException('只能更新状态为"执行中"的工单');
    }

    // 更新处理方案和进度
    const updateData: any = {};
    if (resolution !== undefined) {
      updateData.resolution = resolution;
    }

    const updated = await this.prisma.afterSalesCase.update({
      where: { id },
      data: updateData,
      include: {
        order: true,
        shipment: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        replacementShipment: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        handler: {
          select: {
            id: true,
            username: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
        attachments: true,
        logs: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    // 记录日志
    await this.prisma.afterSalesLog.create({
      data: {
        caseId: id,
        action: 'UPDATED',
        description: progressDescription || (resolution ? '更新了处理方案' : '更新了进度'),
        userId,
      },
    });

    await this.auditService.log({
      action: 'aftersales.update_resolution',
      resource: 'AfterSalesCase',
      resourceId: id,
      userId,
    });

    return updated;
  }

  async findAll(filters?: {
    status?: string;
    type?: string;
    orderId?: string;
    supplierId?: string;
    storeId?: string;
    search?: string;
  }) {
    const where: any = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.type) {
      where.type = filters.type;
    }

    if (filters?.orderId) {
      where.orderId = filters.orderId;
    }

    if (filters?.supplierId) {
      where.supplierId = filters.supplierId;
    }

    if (filters?.storeId) {
      where.storeId = filters.storeId;
    }

    // 搜索功能：支持工单号、订单号、商品名称
    if (filters?.search) {
      where.OR = [
        { caseNo: { contains: filters.search } },
        {
          order: {
            OR: [
              { orderNo: { contains: filters.search } },
              { productName: { contains: filters.search } },
            ],
          },
        },
        {
          shipment: {
            trackingNo: { contains: filters.search },
          },
        },
      ];
    }

    const cases = await this.prisma.afterSalesCase.findMany({
      where,
      include: {
        order: true,
        store: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        shipment: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
            rfqItem: {
              include: {
                rfq: {
                  select: {
                    id: true,
                    rfqNo: true,
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
            },
          },
        },
        handler: {
          select: {
            id: true,
            username: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
        attachments: true,
        logs: {
          take: 5,
          orderBy: {
            createdAt: 'desc',
          },
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 转换附件 URL（从文件 key 生成签名 URL）
    const casesWithUrls = await Promise.all(
      cases.map(async (caseItem) => {
        if (caseItem.attachments && caseItem.attachments.length > 0) {
          const attachmentsWithUrls = await Promise.all(
            caseItem.attachments.map(async (attachment) => {
              try {
                const signedUrl = await this.storageService.getFileUrl(attachment.fileUrl, 3600);
                return {
                  ...attachment,
                  fileUrl: signedUrl,
                };
              } catch (error) {
                console.warn(`[AfterSalesService] 无法生成附件 URL: ${attachment.fileUrl}`, error);
                return attachment;
              }
            })
          );
          return {
            ...caseItem,
            attachments: attachmentsWithUrls,
          };
        }
        return caseItem;
      })
    );

    return casesWithUrls;
  }

  async getStats(supplierId?: string, storeId?: string) {
    const where: any = {};
    if (supplierId) {
      where.supplierId = supplierId;
    }
    if (storeId) {
      where.storeId = storeId;
    }

    const [total, opened, inProgress, pending, resolved, closed, overdue] = await Promise.all([
      this.prisma.afterSalesCase.count({ where }),
      this.prisma.afterSalesCase.count({ where: { ...where, status: 'OPENED' } }),
      this.prisma.afterSalesCase.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      this.prisma.afterSalesCase.count({ where: { ...where, status: 'PENDING' } }),
      this.prisma.afterSalesCase.count({ where: { ...where, status: 'RESOLVED' } }),
      this.prisma.afterSalesCase.count({ where: { ...where, status: 'CLOSED' } }),
      this.prisma.afterSalesCase.count({
        where: {
          ...where,
          slaDeadline: {
            lt: new Date(),
          },
          status: {
            notIn: ['CLOSED', 'RESOLVED', 'CANCELLED'],
          },
        },
      }),
    ]);

    return {
      total,
      opened,
      inProgress,
      pending,
      resolved,
      closed,
      overdue,
    };
  }

  async findOne(id: string) {
    const result = await this.prisma.afterSalesCase.findUnique({
      where: { id },
      include: {
        order: true,
        store: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        shipment: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
            rfqItem: {
              include: {
                rfq: {
                  select: {
                    id: true,
                    rfqNo: true,
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
            },
          },
        },
        handler: {
          select: {
            id: true,
            username: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
        attachments: true,
        logs: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    });

    if (!result) {
      return null;
    }

    // 转换附件 URL（从文件 key 生成签名 URL）
    if (result.attachments && result.attachments.length > 0) {
      const attachmentsWithUrls = await Promise.all(
        result.attachments.map(async (attachment) => {
          try {
            const signedUrl = await this.storageService.getFileUrl(attachment.fileUrl, 3600);
            return {
              ...attachment,
              fileUrl: signedUrl,
            };
          } catch (error) {
            console.warn(`[AfterSalesService] 无法生成附件 URL: ${attachment.fileUrl}`, error);
            return attachment;
          }
        })
      );
      result.attachments = attachmentsWithUrls;
    }

    return result;
  }

  async findByTrackingNo(trackingNo: string) {
    // 首先尝试从 Shipment 表查找（供应商发货）
    const shipment = await this.prisma.shipment.findFirst({
      where: { trackingNo },
      include: {
        supplier: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        rfqItem: {
          include: {
            rfq: {
              include: {
                store: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                  },
                },
                orders: {
                  include: {
                    order: {
                      select: {
                        id: true,
                        orderNo: true,
                        productName: true,
                        recipient: true,
                        phone: true,
                        address: true,
                        storeId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        order: {
          select: {
            id: true,
            orderNo: true,
            productName: true,
            recipient: true,
            phone: true,
            address: true,
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

    if (shipment) {
      // 获取店铺信息：优先从 order.store，其次从 rfq.store
      let store = null;
      if (shipment.order?.store) {
        store = shipment.order.store;
      } else if (shipment.rfqItem?.rfq?.store) {
        store = shipment.rfqItem.rfq.store;
      } else if (shipment.order?.storeId) {
        // 如果只有 storeId，需要查询店铺信息
        const storeInfo = await this.prisma.store.findUnique({
          where: { id: shipment.order.storeId },
          select: {
            id: true,
            name: true,
            code: true,
          },
        });
        if (storeInfo) {
          store = storeInfo;
        }
      }

      return {
        shipmentId: shipment.id,
        trackingNo: shipment.trackingNo,
        carrier: shipment.carrier,
        source: shipment.source, // SUPPLIER 或 ECOMMERCE
        supplier: shipment.supplier ? {
          id: shipment.supplier.id,
          username: shipment.supplier.username,
          email: shipment.supplier.email,
        } : null,
        store: store ? {
          id: store.id,
          name: store.name,
          code: store.code,
        } : null,
        order: shipment.order || (shipment.rfqItem?.rfq?.orders?.[0]?.order),
        rfqItem: shipment.rfqItem ? {
          id: shipment.rfqItem.id,
          productName: shipment.rfqItem.productName,
          quantity: shipment.rfqItem.quantity,
          rfqNo: shipment.rfqItem.rfq.rfqNo,
        } : null,
      };
    }

    // 如果 Shipment 中没有找到，尝试从 RFQItem 查找（电商平台采购）
    const rfqItem = await this.prisma.rfqItem.findFirst({
      where: {
        trackingNo,
        source: 'ECOMMERCE',
      },
      include: {
        rfq: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            orders: {
              include: {
                order: {
                  select: {
                    id: true,
                    orderNo: true,
                    productName: true,
                    recipient: true,
                    phone: true,
                    address: true,
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
            },
          },
        },
      },
    });

    if (rfqItem) {
      // 获取店铺信息：优先从 order.store，其次从 rfq.store
      let store = null;
      if (rfqItem.rfq.orders && rfqItem.rfq.orders.length > 0 && rfqItem.rfq.orders[0].order?.store) {
        store = rfqItem.rfq.orders[0].order.store;
      } else if (rfqItem.rfq.store) {
        store = rfqItem.rfq.store;
      } else if (rfqItem.rfq.orders && rfqItem.rfq.orders.length > 0 && rfqItem.rfq.orders[0].order?.storeId) {
        const storeInfo = await this.prisma.store.findUnique({
          where: { id: rfqItem.rfq.orders[0].order.storeId },
          select: {
            id: true,
            name: true,
            code: true,
          },
        });
        if (storeInfo) {
          store = storeInfo;
        }
      }

      return {
        shipmentId: null, // 电商平台采购没有 Shipment 记录
        trackingNo: rfqItem.trackingNo,
        carrier: rfqItem.carrier || null,
        source: 'ECOMMERCE',
        supplier: null, // 电商平台采购没有供应商
        store: store ? {
          id: store.id,
          name: store.name,
          code: store.code,
        } : null,
        order: rfqItem.rfq.orders?.[0]?.order || null,
        rfqItem: {
          id: rfqItem.id,
          productName: rfqItem.productName,
          quantity: rfqItem.quantity,
          rfqNo: rfqItem.rfq.rfqNo,
        },
      };
    }

    // 都没有找到
    return null;
  }

  async uploadAttachments(caseId: string, files: Express.Multer.File[], userId?: string) {
    // 验证工单是否存在
    const afterSalesCase = await this.prisma.afterSalesCase.findUnique({
      where: { id: caseId },
    });

    if (!afterSalesCase) {
      throw new Error('售后工单不存在');
    }

    // 上传所有文件
    const attachments = await Promise.all(
      files.map(async (file) => {
        try {
          // 上传文件到 MinIO
          const fileUrl = await this.storageService.uploadFile(file, 'after-sales-attachments');
          
          // 从 URL 中提取文件 key（用于存储到数据库）
          let fileKey: string;
          try {
            const url = new URL(fileUrl);
            let keyFromUrl = url.pathname.substring(1);
            if (keyFromUrl.startsWith('eggpurchase/')) {
              keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
            }
            fileKey = keyFromUrl;
          } catch (urlError) {
            fileKey = fileUrl;
          }

          // 保存附件记录
          const attachment = await this.prisma.afterSalesAttachment.create({
            data: {
              caseId,
              fileUrl: fileKey, // 存储文件 key 而不是完整 URL
              fileType: file.mimetype,
              fileName: file.originalname,
            },
          });

          return attachment;
        } catch (error: any) {
          console.error(`[AfterSalesService] 上传附件失败:`, error);
          throw new Error(`上传附件失败: ${file.originalname} - ${error.message}`);
        }
      })
    );

    // 记录日志
    await this.prisma.afterSalesLog.create({
      data: {
        caseId,
        action: 'ATTACHMENT_UPLOADED',
        description: `上传了 ${files.length} 个附件`,
        userId,
      },
    });

    return attachments;
  }

  /**
   * 换货时上传快递单号（供应商使用）
   * 创建发货单并同步到发货管理
   */
  async uploadReplacementTracking(
    id: string,
    trackingNo: string,
    carrier?: string,
    userId?: string,
  ) {
    try {
      // 验证工单是否存在
      const afterSales = await this.prisma.afterSalesCase.findUnique({
        where: { id },
        include: {
          order: {
            select: {
              id: true,
              orderNo: true,
            },
          },
          shipment: {
            include: {
              rfqItem: {
                include: {
                  rfq: {
                    select: {
                      id: true,
                      rfqNo: true,
                    },
                  },
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

      if (!afterSales) {
        throw new NotFoundException('售后工单不存在');
      }

      // 验证是否为换货类型
      if (afterSales.type !== 'REPAIR' && afterSales.inventoryDisposition !== '换货') {
        throw new BadRequestException('只有换货类型的售后工单才能上传换货快递单号');
      }

      // 验证权限：供应商只能上传自己的工单
      if (userId && afterSales.supplierId && afterSales.supplierId !== userId) {
        throw new BadRequestException('无权操作此售后工单');
      }

      // 验证状态：只有执行中的工单可以上传换货快递单号
      if (afterSales.status !== 'EXECUTING') {
        throw new BadRequestException('只能为状态为"执行中"的工单上传换货快递单号');
      }

      // 如果已经存在换货发货单，不允许重复上传
      if (afterSales.replacementShipmentId) {
        throw new BadRequestException('换货快递单号已上传，如需修改请联系管理员');
      }

      // 查找原始发货单关联的 RFQItem 或 Award
      let rfqItemId: string | null = null;
      let awardId: string | null = null;

      if (afterSales.shipment?.rfqItemId) {
        rfqItemId = afterSales.shipment.rfqItemId;
      } else if (afterSales.shipment?.awardId) {
        awardId = afterSales.shipment.awardId;
      } else {
        // 如果没有原始发货单，尝试从订单关联的询价单获取
        const orderRfq = await this.prisma.orderRfq.findFirst({
          where: { orderId: afterSales.orderId },
          include: {
            rfq: {
              include: {
                items: {
                  where: {
                    itemStatus: 'AWARDED',
                  },
                  take: 1,
                },
              },
            },
          },
        });

        if (orderRfq?.rfq?.items && orderRfq.rfq.items.length > 0) {
          rfqItemId = orderRfq.rfq.items[0].id;
        }
      }

      // 创建换货发货单
      const replacementShipment = await this.prisma.shipment.create({
        data: {
          shipmentNo: `REPLACE-${Date.now()}`,
          orderId: afterSales.orderId,
          awardId: awardId || undefined,
          supplierId: afterSales.supplierId || undefined,
          trackingNo,
          carrier: carrier || null,
          status: 'PENDING',
          source: 'SUPPLIER',
          rfqItemId: rfqItemId || undefined,
        },
        include: {
          order: true,
          supplier: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      // 更新售后工单，关联换货发货单
      const updated = await this.prisma.afterSalesCase.update({
        where: { id },
        data: {
          replacementShipmentId: replacementShipment.id,
        },
        include: {
          order: true,
          store: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          shipment: {
            include: {
              supplier: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
          replacementShipment: {
            include: {
              supplier: {
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
          attachments: true,
          logs: {
            include: {
              user: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
            orderBy: {
              createdAt: 'desc',
            },
          },
        },
      });

      // 记录日志
      await this.prisma.afterSalesLog.create({
        data: {
          caseId: id,
          action: 'REPLACEMENT_SHIPPED',
          description: `已上传换货快递单号：${trackingNo}${carrier ? `（${carrier}）` : ''}`,
          userId,
        },
      });

      // 记录审计日志
      try {
        await this.auditService.log({
          action: 'aftersales.upload_replacement_tracking',
          resource: 'AfterSalesCase',
          resourceId: id,
          userId,
          details: {
            trackingNo,
            carrier,
            replacementShipmentId: replacementShipment.id,
          },
        });
      } catch (auditError) {
        const errorMessage = auditError instanceof Error ? auditError.message : String(auditError);
        this.logger.warn('记录审计日志失败', {
          afterSalesId: id,
          userId,
          error: errorMessage,
        });
      }

      this.logger.log('换货快递单号已上传', {
        caseNo: afterSales.caseNo,
        trackingNo,
        carrier,
        replacementShipmentId: replacementShipment.id,
        userId,
      });

      return updated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      this.logger.error('上传换货快递单号失败', {
        caseId: id,
        trackingNo,
        carrier,
        userId,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      // 如果是已知的业务异常，直接抛出
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new BadRequestException(`上传换货快递单号失败：${errorMessage}`);
    }
  }

  private calculateSLADeadline(priority: string): Date {
    const now = new Date();
    // 所有优先级统一设置为 7 天（168小时）
    const hours = 168; // 7 days

    return new Date(now.getTime() + hours * 60 * 60 * 1000);
  }
}

