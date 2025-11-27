import { Injectable, BadRequestException, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateOrderFromInventoryDto } from './dto/create-order-from-inventory.dto';
import { OrderStatus } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as csv from 'csv-parse/sync';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
  ) {}

  async create(createOrderDto: CreateOrderDto) {
    try {
      // 验证必填字段
      if (!createOrderDto.orderNo || createOrderDto.orderNo.trim() === '') {
        throw new BadRequestException('订单号不能为空');
      }

      // 检查订单号是否已存在
      const existingOrder = await this.prisma.order.findUnique({
        where: { orderNo: createOrderDto.orderNo },
      });

      if (existingOrder) {
        throw new BadRequestException(`订单号已存在：${createOrderDto.orderNo}`);
      }

      const order = await this.prisma.order.create({
        data: createOrderDto,
      });

      this.logger.log('订单创建成功', {
        orderId: order.id,
        orderNo: order.orderNo,
      });

      return order;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('创建订单失败', {
        orderNo: createOrderDto.orderNo,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      if (errorMessage.includes('Unique constraint') || errorMessage.includes('唯一约束')) {
        throw new BadRequestException(`订单号已存在：${createOrderDto.orderNo}`);
      }

      throw new BadRequestException(`创建订单失败：${errorMessage}`);
    }
  }

  /**
   * 从供应商库存创建订单
   */
  async createFromInventory(createOrderDto: CreateOrderFromInventoryDto) {
    try {
      // 验证必填字段
      if (!createOrderDto.orderNo || createOrderDto.orderNo.trim() === '') {
        throw new BadRequestException('订单号不能为空');
      }

      if (!createOrderDto.inventoryId || !createOrderDto.supplierId) {
        throw new BadRequestException('库存ID和供应商ID不能为空');
      }

      // 检查订单号是否已存在
      const existingOrder = await this.prisma.order.findUnique({
        where: { orderNo: createOrderDto.orderNo },
      });

      if (existingOrder) {
        throw new BadRequestException(`订单号已存在：${createOrderDto.orderNo}`);
      }

      // 验证库存是否存在且有足够数量
      const inventory = await this.prisma.supplierInventory.findUnique({
        where: { id: createOrderDto.inventoryId },
      });

      if (!inventory) {
        throw new NotFoundException('库存不存在');
      }

      if (inventory.supplierId !== createOrderDto.supplierId) {
        throw new BadRequestException('库存与供应商不匹配');
      }

      if (inventory.status !== 'ACTIVE') {
        throw new BadRequestException('库存已下架或不可用');
      }

      if (inventory.quantity < createOrderDto.quantity) {
        throw new BadRequestException(`库存不足，当前可用数量：${inventory.quantity}`);
      }

      // 使用事务创建订单和发货单，并扣减库存
      const result = await this.prisma.$transaction(async (tx) => {
        // 创建订单
        const order = await tx.order.create({
          data: {
            orderNo: createOrderDto.orderNo,
            orderTime: new Date(createOrderDto.orderTime),
            openid: createOrderDto.openid,
            recipient: createOrderDto.recipient,
            phone: createOrderDto.phone,
            address: createOrderDto.address,
            modifiedAddress: createOrderDto.modifiedAddress,
            productName: createOrderDto.productName,
            price: createOrderDto.price,
            points: createOrderDto.points || 0,
            storeId: createOrderDto.storeId,
            buyerId: createOrderDto.buyerId,
            userNickname: createOrderDto.userNickname,
            source: 'ECOMMERCE', // 标记为门店订单（从库存下单，使用ECOMMERCE类型）
            status: 'PENDING',
          },
        });

        // 创建发货单（待供应商填写快递单号）
        const shipmentNo = `SHIP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        const shipment = await tx.shipment.create({
          data: {
            shipmentNo,
            orderId: order.id,
            supplierId: createOrderDto.supplierId,
            status: 'PENDING',
            source: 'ECOMMERCE', // 从库存下单的发货单，使用ECOMMERCE类型
          },
        });

        // 扣减库存数量
        const newQuantity = inventory.quantity - createOrderDto.quantity;
        await tx.supplierInventory.update({
          where: { id: createOrderDto.inventoryId },
          data: {
            quantity: newQuantity,
            status: newQuantity === 0 ? 'SOLD_OUT' : inventory.status,
          },
        });

        this.logger.log('从库存创建订单成功', {
          orderId: order.id,
          orderNo: order.orderNo,
          inventoryId: createOrderDto.inventoryId,
          supplierId: createOrderDto.supplierId,
          quantity: createOrderDto.quantity,
        });

        return {
          order,
          shipment,
        };
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('从库存创建订单失败', {
        orderNo: createOrderDto.orderNo,
        inventoryId: createOrderDto.inventoryId,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new BadRequestException(`创建订单失败：${errorMessage}`);
    }
  }

  /**
   * 获取供应商的订单列表（包括从库存下单的订单）
   */
  async findSupplierOrders(supplierId: string, filters?: { status?: string }, requestOrigin?: string) {
    const where: any = {
      shipments: {
        some: {
          supplierId,
        },
      },
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    const orders = await this.prisma.order.findMany({
      where,
      include: {
        shipments: {
          where: {
            supplierId,
          },
          include: {
            packages: {
              select: {
                id: true,
                photos: true,
                labelUrl: true,
              },
            },
          },
        },
        store: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 转换照片 URL
    return this.convertPhotosToUrls(orders, requestOrigin);
  }

  async findAll(filters?: {
    status?: string;
    storeId?: string;
    startDate?: Date;
    endDate?: Date;
  }, requestOrigin?: string) {
    try {
      const orders = await this.prisma.order.findMany({
        where: {
          status: filters?.status ? (filters.status as OrderStatus) : undefined,
          storeId: filters?.storeId,
          orderTime: filters?.startDate || filters?.endDate ? {
            gte: filters?.startDate,
            lte: filters?.endDate,
          } : undefined,
        },
        include: {
          shipments: {
            include: {
              packages: {
                select: {
                  id: true,
                  photos: true,
                  labelUrl: true,
                },
              },
              settlements: {
                orderBy: { createdAt: 'desc' },
                take: 1,
              },
            },
          },
          store: true,
          buyer: {
            select: {
              id: true,
              username: true,
              email: true,
            },
          },
        },
        orderBy: {
          orderTime: 'desc',
        },
      });

      // 转换照片 URL
      return this.convertPhotosToUrls(orders, requestOrigin);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('查询订单列表失败', {
        filters,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('查询订单列表失败，请稍后重试');
    }
  }

  async findOne(id: string, storeId?: string, requestOrigin?: string) {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('订单ID不能为空');
      }

      const order = await this.prisma.order.findUnique({
        where: { id },
        include: {
          store: true,
          buyer: true,
          rfqs: {
            include: {
              rfq: true,
            },
          },
          shipments: {
            include: {
              packages: {
                select: {
                  id: true,
                  photos: true,
                  labelUrl: true,
                },
              },
            },
          },
          afterSales: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`订单不存在：${id}`);
      }

      // 门店用户只能查看自己门店的订单
      if (storeId && order.storeId !== storeId) {
        throw new NotFoundException('无权访问此订单');
      }

      // 转换照片 URL
      const orders = await this.convertPhotosToUrls([order], requestOrigin);
      return orders[0];
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('查询订单详情失败', {
        id,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('查询订单详情失败，请稍后重试');
    }
  }

  async updateStatus(id: string, status: string) {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('订单ID不能为空');
      }
      if (!status || status.trim() === '') {
        throw new BadRequestException('订单状态不能为空');
      }

      // 验证订单是否存在
      const order = await this.prisma.order.findUnique({
        where: { id },
      });

      if (!order) {
        throw new NotFoundException(`订单不存在：${id}`);
      }

      const updated = await this.prisma.order.update({
        where: { id },
        data: { status: status as OrderStatus },
      });

      this.logger.log('订单状态更新成功', {
        orderId: id,
        orderNo: order.orderNo,
        oldStatus: order.status,
        newStatus: status,
      });

      return updated;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('更新订单状态失败', {
        id,
        status,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new BadRequestException(`更新订单状态失败：${errorMessage}`);
    }
  }

  /**
   * 根据订单号更新物流信息
   */
  async updateTrackingByOrderNo(orderNo: string, trackingNo: string, carrier?: string, requestOrigin?: string) {
    try {
      if (!orderNo || orderNo.trim() === '') {
        throw new BadRequestException('订单号不能为空');
      }
      if (!trackingNo || trackingNo.trim() === '') {
        throw new BadRequestException('物流单号不能为空');
      }

      const order = await this.prisma.order.findFirst({
        where: { orderNo },
      });

      if (!order) {
        throw new NotFoundException(`订单不存在：${orderNo}`);
      }

    // 更新订单的物流信息（如果订单表有这些字段）
    // 注意：根据 schema，Order 表可能没有 trackingNo 字段，需要通过 Shipment 关联
    // 这里我们查找或创建 Shipment 记录
    const shipment = await this.prisma.shipment.findFirst({
      where: {
        orderId: order.id,
        trackingNo,
      },
    });

    if (!shipment) {
      // 如果不存在，创建一个新的 Shipment 记录
      await this.prisma.shipment.create({
        data: {
          shipmentNo: `SHIP-${Date.now()}`,
          orderId: order.id,
          trackingNo,
          carrier: carrier || null,
          source: 'SUPPLIER',
        },
      });
    } else {
      // 更新现有的 Shipment 记录
      await this.prisma.shipment.update({
        where: { id: shipment.id },
        data: {
          carrier: carrier || shipment.carrier,
        },
      });
    }

      return await this.findOne(order.id, undefined, requestOrigin);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('更新订单物流信息失败', {
        orderNo,
        trackingNo,
        carrier,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new BadRequestException(`更新订单物流信息失败：${errorMessage}`);
    }
  }

  /**
   * 一键同步所有物流单号到订单系统
   * 查找所有有物流单号但没有 orderId 的 Shipment，通过 RfqItem.orderNo 找到对应的订单并更新
   */
  async syncAllTrackingToOrders() {
    try {
      // 查找所有有物流单号但没有 orderId 的 Shipment 记录
      const shipments = await this.prisma.shipment.findMany({
      where: {
        trackingNo: { not: null },
        orderId: null,
        rfqItemId: { not: null },
      },
      include: {
        rfqItem: {
          select: {
            id: true,
            orderNo: true,
          },
        },
      },
    });

    if (shipments.length === 0) {
      return {
        total: 0,
        success: 0,
        failed: 0,
        message: '没有需要同步的发货单',
      };
    }

    let successCount = 0;
    let failedCount = 0;
    const errors: Array<{ shipmentId: string; error: string }> = [];

    // 批量处理每个发货单
    for (const shipment of shipments) {
      try {
        // 如果 RfqItem 没有 orderNo，跳过
        if (!shipment.rfqItem?.orderNo) {
          failedCount++;
          errors.push({
            shipmentId: shipment.id,
            error: 'RfqItem 没有 orderNo',
          });
          continue;
        }

        // 根据 orderNo 查找订单
        const order = await this.prisma.order.findFirst({
          where: { orderNo: shipment.rfqItem.orderNo },
        });

        if (!order) {
          failedCount++;
          errors.push({
            shipmentId: shipment.id,
            error: `订单不存在: ${shipment.rfqItem.orderNo}`,
          });
          continue;
        }

        // 检查是否已经有相同 orderId 和 trackingNo 的 Shipment（避免重复）
        const existingShipment = await this.prisma.shipment.findFirst({
          where: {
            orderId: order.id,
            trackingNo: shipment.trackingNo,
            id: { not: shipment.id },
          },
        });

        if (existingShipment) {
          // 如果已存在，更新当前 Shipment 的 orderId
          await this.prisma.shipment.update({
            where: { id: shipment.id },
            data: { orderId: order.id },
          });
          successCount++;
        } else {
          // 更新 Shipment 的 orderId
          await this.prisma.shipment.update({
            where: { id: shipment.id },
            data: { orderId: order.id },
          });
          successCount++;
        }
      } catch (error: any) {
        failedCount++;
        errors.push({
          shipmentId: shipment.id,
          error: error.message || String(error),
        });
      }
    }

      this.logger.log('物流单号同步完成', {
        total: shipments.length,
        success: successCount,
        failed: failedCount,
      });

      return {
        total: shipments.length,
        success: successCount,
        failed: failedCount,
        errors: errors.slice(0, 10), // 只返回前10个错误，避免响应过大
        message: `同步完成：成功 ${successCount} 个，失败 ${failedCount} 个`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('同步物流单号失败', {
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException(`同步物流单号失败：${errorMessage}`);
    }
  }

  /**
   * 查询历史表格数据（整合订单、发货、询价单商品信息）
   */
  async findHistoryData(filters?: {
    startDate?: Date;
    endDate?: Date;
    orderNo?: string;
    trackingNo?: string;
    recipient?: string;
    phone?: string;
    productName?: string;
    status?: string;
    storeId?: string;
  }) {
    try {
      // 构建查询条件
      const where: Record<string, any> = {};

    if (filters?.startDate || filters?.endDate) {
      where.orderTime = {};
      if (filters?.startDate) {
        where.orderTime.gte = filters.startDate;
      }
      if (filters?.endDate) {
        where.orderTime.lte = filters.endDate;
      }
    }

    if (filters?.orderNo) {
      where.orderNo = { contains: filters.orderNo };
    }

    if (filters?.recipient) {
      where.recipient = { contains: filters.recipient };
    }

    if (filters?.phone) {
      where.phone = { contains: filters.phone };
    }

    if (filters?.productName) {
      where.productName = { contains: filters.productName };
    }

    if (filters?.status) {
      where.status = filters.status as OrderStatus;
    }

    if (filters?.storeId) {
      where.storeId = filters.storeId;
    }

    // 查询订单及其关联数据
    const orders = await this.prisma.order.findMany({
      where,
      include: {
        store: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        shipments: {
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
        rfqs: {
          include: {
            rfq: {
              include: {
                items: {
                  where: filters?.trackingNo
                    ? {
                        trackingNo: { contains: filters.trackingNo },
                      }
                    : undefined,
                },
              },
            },
          },
        },
      },
      orderBy: {
        orderTime: 'desc',
      },
    });

      // 扁平化数据，将订单、发货单、商品信息整合
      const historyData: Array<Record<string, any>> = [];

    for (const order of orders) {
      // 如果订单有发货单，为每个发货单创建一条记录
      if (order.shipments && order.shipments.length > 0) {
        for (const shipment of order.shipments) {
          // 如果发货单有对应的RfqItem，使用RfqItem的数据
          if (shipment.rfqItem) {
            historyData.push({
              shipmentNo: shipment.shipmentNo,
              orderNo: order.orderNo,
              openid: order.openid,
              recipient: order.recipient,
              phone: order.phone,
              address: order.address,
              modifiedAddress: order.modifiedAddress || '',
              productName: shipment.rfqItem.productName || order.productName,
              quantity: shipment.rfqItem.quantity || 1,
              price: Number(order.price),
              points: order.points,
              status: order.status,
              date: order.orderTime,
              notes: shipment.rfqItem.notes || '',
              trackingNo: shipment.trackingNo || '',
              costPrice: shipment.rfqItem.costPrice ? Number(shipment.rfqItem.costPrice) : null,
              carrier: shipment.carrier || '',
              shippedAt: shipment.shippedAt || order.shippedAt,
              storeName: order.store?.name || '',
              storeCode: order.store?.code || '',
            });
          } else {
            // 如果没有RfqItem，使用订单数据
            historyData.push({
              shipmentNo: shipment.shipmentNo,
              orderNo: order.orderNo,
              openid: order.openid,
              recipient: order.recipient,
              phone: order.phone,
              address: order.address,
              modifiedAddress: order.modifiedAddress || '',
              productName: order.productName,
              quantity: 1,
              price: Number(order.price),
              points: order.points,
              status: order.status,
              date: order.orderTime,
              notes: '',
              trackingNo: shipment.trackingNo || '',
              costPrice: null,
              carrier: shipment.carrier || '',
              shippedAt: shipment.shippedAt || order.shippedAt,
              storeName: order.store?.name || '',
              storeCode: order.store?.code || '',
            });
          }
        }
      } else {
        // 如果订单没有发货单，检查是否有关联的RfqItem
        let hasRfqItem = false;
        for (const orderRfq of order.rfqs || []) {
          for (const rfqItem of orderRfq.rfq.items || []) {
            // 如果RfqItem的orderNo匹配，使用RfqItem的数据
            if (rfqItem.orderNo === order.orderNo) {
              hasRfqItem = true;
              historyData.push({
                shipmentNo: '',
                orderNo: order.orderNo,
                openid: order.openid,
                recipient: order.recipient,
                phone: order.phone,
                address: order.address,
                modifiedAddress: order.modifiedAddress || '',
                productName: rfqItem.productName || order.productName,
                quantity: rfqItem.quantity || 1,
                price: Number(order.price),
                points: order.points,
                status: order.status,
                date: order.orderTime,
                notes: rfqItem.notes || '',
                trackingNo: rfqItem.trackingNo || '',
                costPrice: rfqItem.costPrice ? Number(rfqItem.costPrice) : null,
                carrier: rfqItem.carrier || '',
                shippedAt: order.shippedAt,
                storeName: order.store?.name || '',
                storeCode: order.store?.code || '',
              });
            }
          }
        }

        // 如果没有找到匹配的RfqItem，使用订单数据
        if (!hasRfqItem) {
          historyData.push({
            shipmentNo: '',
            orderNo: order.orderNo,
            openid: order.openid,
            recipient: order.recipient,
            phone: order.phone,
            address: order.address,
            modifiedAddress: order.modifiedAddress || '',
            productName: order.productName,
            quantity: 1,
            price: Number(order.price),
            points: order.points,
            status: order.status,
            date: order.orderTime,
            notes: '',
            trackingNo: '',
            costPrice: null,
            carrier: '',
            shippedAt: order.shippedAt,
            storeName: order.store?.name || '',
            storeCode: order.store?.code || '',
          });
        }
      }
    }

      // 如果指定了trackingNo筛选，再次过滤
      if (filters?.trackingNo) {
        return historyData.filter((item) =>
          item.trackingNo?.toLowerCase().includes(filters.trackingNo!.toLowerCase()),
        );
      }

      return historyData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('查询历史数据失败', {
        filters,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('查询历史数据失败，请稍后重试');
    }
  }

  /**
   * 获取历史数据统计信息（增强版）
   */
  async getHistoryStats(filters?: {
    startDate?: Date;
    endDate?: Date;
    storeId?: string;
    status?: string;
  }) {
    try {
      const where: Record<string, any> = {};

    if (filters?.startDate || filters?.endDate) {
      where.orderTime = {};
      if (filters?.startDate) {
        where.orderTime.gte = filters.startDate;
      }
      if (filters?.endDate) {
        where.orderTime.lte = filters.endDate;
      }
    }

    if (filters?.storeId) {
      where.storeId = filters.storeId;
    }

      if (filters?.status) {
        where.status = filters.status as OrderStatus;
      }

      const orders = await this.prisma.order.findMany({
        where,
        include: {
          store: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          shipments: {
            include: {
              rfqItem: true,
            },
          },
        },
      });

    // 基础统计
    const stats = {
      totalOrders: orders.length,
      totalAmount: orders.reduce((sum, order) => sum + Number(order.price), 0),
      totalPoints: orders.reduce((sum, order) => sum + order.points, 0),
      totalShipments: orders.reduce((sum, order) => sum + order.shipments.length, 0),
      statusCount: {
        PENDING: 0,
        PROCESSING: 0,
        SHIPPED: 0,
        DELIVERED: 0,
        CANCELLED: 0,
      },
      // 按门店统计
      storeStats: {} as { [storeId: string]: { name: string; code: string; count: number; amount: number } },
      // 按日期统计（最近30天）
      dailyStats: [] as Array<{ date: string; count: number; amount: number }>,
      // 按商品统计（Top 10）
      productStats: {} as { [productName: string]: { count: number; amount: number; quantity: number } },
      // 平均订单金额
      avgOrderAmount: 0,
      // 最大订单金额
      maxOrderAmount: 0,
      // 最小订单金额
      minOrderAmount: 0,
    };

    // 计算日期范围（最近30天或指定范围）
    const endDate = filters?.endDate || new Date();
    const startDate = filters?.startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const daysDiff = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
    const daysToShow = Math.min(daysDiff, 30);

    // 初始化每日统计
    for (let i = 0; i < daysToShow; i++) {
      const date = new Date(endDate);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      stats.dailyStats.push({ date: dateStr, count: 0, amount: 0 });
    }

    // 处理每个订单
    orders.forEach((order) => {
      // 状态统计
      if (stats.statusCount[order.status as keyof typeof stats.statusCount] !== undefined) {
        stats.statusCount[order.status as keyof typeof stats.statusCount]++;
      }

      // 门店统计
      if (order.storeId) {
        if (!stats.storeStats[order.storeId]) {
          stats.storeStats[order.storeId] = {
            name: order.store?.name || '未知门店',
            code: order.store?.code || '',
            count: 0,
            amount: 0,
          };
        }
        stats.storeStats[order.storeId].count++;
        stats.storeStats[order.storeId].amount += Number(order.price);
      }

      // 每日统计
      const orderDateStr = order.orderTime.toISOString().split('T')[0];
      const dailyStat = stats.dailyStats.find((d) => d.date === orderDateStr);
      if (dailyStat) {
        dailyStat.count++;
        dailyStat.amount += Number(order.price);
      }

      // 商品统计
      const productName = order.productName || '未知商品';
      if (!stats.productStats[productName]) {
        stats.productStats[productName] = {
          count: 0,
          amount: 0,
          quantity: 0,
        };
      }
      stats.productStats[productName].count++;
      stats.productStats[productName].amount += Number(order.price);
      stats.productStats[productName].quantity += 1; // 订单数量，不是商品数量
    });

    // 计算平均值
    if (orders.length > 0) {
      stats.avgOrderAmount = stats.totalAmount / orders.length;
      const amounts = orders.map((o) => Number(o.price));
      stats.maxOrderAmount = Math.max(...amounts);
      stats.minOrderAmount = Math.min(...amounts);
    }

    // 按日期倒序排列
    stats.dailyStats.reverse();

    // 获取Top 10商品
    const topProducts = Object.entries(stats.productStats)
      .map(([name, data]) => ({ name, ...data }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

      return {
        ...stats,
        topProducts,
        storeStatsList: Object.entries(stats.storeStats).map(([id, data]) => ({
          storeId: id,
          ...data,
        })),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('获取历史数据统计失败', {
        filters,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('获取历史数据统计失败，请稍后重试');
    }
  }

  /**
   * 导入历史数据（从CSV/Excel文件）
   */
  async importHistoryData(
    file: Express.Multer.File,
    storeId: string,
  ): Promise<{
    totalRows: number;
    successRows: number;
    errorRows: number;
    errors: Array<{ row: number; data: any; error: string }>;
  }> {
    try {
      // 验证文件
      if (!file || !file.buffer) {
        throw new BadRequestException('文件不能为空');
      }

      // 验证门店ID
      if (!storeId || storeId.trim() === '') {
        throw new BadRequestException('门店ID不能为空');
      }

      // 验证门店是否存在
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
      });

      if (!store) {
        throw new NotFoundException(`门店不存在：${storeId}`);
      }

      // 解析文件
      const rows = await this.parseHistoryFile(file);
      const errors: Array<{ row: number; data: any; error: string }> = [];
      let successCount = 0;

      this.logger.log('开始导入历史数据', {
        filename: file.originalname,
        storeId,
        totalRows: rows.length,
      });

      // 批量导入
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          await this.importHistoryRow(row, storeId, i + 1);
          successCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            row: i + 1,
            data: row,
            error: errorMessage,
          });
          // 记录单个行错误，但不中断整个导入流程
          this.logger.warn('导入历史数据行失败', {
            row: i + 1,
            storeId,
            error: errorMessage,
          });
        }
      }

      this.logger.log('历史数据导入完成', {
        storeId,
        totalRows: rows.length,
        successRows: successCount,
        errorRows: errors.length,
      });

      return {
        totalRows: rows.length,
        successRows: successCount,
        errorRows: errors.length,
        errors: errors.slice(0, 100), // 限制错误数量，避免响应过大
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('导入历史数据失败', {
        filename: file?.originalname,
        storeId,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }

      throw new BadRequestException(`导入历史数据失败：${errorMessage}`);
    }
  }

  /**
   * 解析历史数据文件（CSV/Excel）
   */
  private async parseHistoryFile(file: Express.Multer.File): Promise<Array<Record<string, any>>> {
    try {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      let rows: Array<Record<string, any>> = [];

      if (!ext) {
        throw new BadRequestException('文件缺少扩展名，无法识别文件格式');
      }

      if (ext === 'xlsx' || ext === 'xls') {
        try {
          const workbook = XLSX.read(file.buffer, { type: 'buffer' });
          
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new BadRequestException('Excel 文件不包含任何工作表');
          }
          
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          
          if (!worksheet) {
            throw new BadRequestException(`无法读取工作表 "${sheetName}"`);
          }
          
          rows = XLSX.utils.sheet_to_json(worksheet);
        } catch (parseError) {
          const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
          this.logger.error('Excel 文件解析失败', {
            filename: file.originalname,
            error: errorMessage,
          });
          throw new BadRequestException(`Excel 文件解析失败：${errorMessage}。请确保文件格式正确且未被损坏`);
        }
      } else if (ext === 'csv') {
        try {
          rows = csv.parse(file.buffer.toString(), {
            columns: true,
            skip_empty_lines: true,
            encoding: 'utf8',
          });
        } catch (parseError) {
          const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
          this.logger.error('CSV 文件解析失败', {
            filename: file.originalname,
            error: errorMessage,
          });
          throw new BadRequestException(`CSV 文件解析失败：${errorMessage}。请确保文件格式正确且使用 UTF-8 编码`);
        }
      } else {
        throw new BadRequestException(`不支持的文件格式 "${ext}"，请使用 Excel (.xlsx, .xls) 或 CSV 格式`);
      }

      return rows;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`文件解析失败：${errorMessage}`);
    }
  }

  /**
   * 导入单行历史数据
   */
  private async importHistoryRow(row: any, storeId: string, rowNumber: number): Promise<void> {
    // 字段映射（支持中英文表头）
    const fieldMap: { [key: string]: string[] } = {
      // 发货编号
      shipmentNo: ['发货编号', 'shipmentNo', 'shipment_no', '发货单号'],
      // 订单号
      orderNo: ['订单号', 'orderNo', 'order_no', '订单编号'],
      // open_id
      openid: ['open_id', 'openid', 'openId', 'openID'],
      // 收件人
      recipient: ['收件人', 'recipient', '收货人', '姓名'],
      // 手机号
      phone: ['手机号', 'phone', '联系电话', '电话', '手机'],
      // 地址
      address: ['地址', 'address', '收货地址', '详细地址'],
      // 修改地址
      modifiedAddress: ['修改地址', 'modifiedAddress', 'modified_address', '新地址'],
      // 货名
      productName: ['货名', 'productName', 'product_name', '商品名称', '商品名', '产品名称'],
      // 数量
      quantity: ['数量', 'quantity', 'qty', '件数'],
      // 机台标价
      price: ['机台标价', 'price', '单价', '价格', '金额'],
      // 积分
      points: ['积分', 'points', 'point', '积分值'],
      // 状态
      status: ['状态', 'status', '订单状态'],
      // 日期
      date: ['日期', 'date', 'orderTime', 'order_time', '订单时间', '时间'],
      // 备注
      notes: ['备注', 'notes', 'note', '说明', '描述'],
      // 快递单号
      trackingNo: ['快递单号', 'trackingNo', 'tracking_no', '运单号', '物流单号'],
      // 成本价
      costPrice: ['成本价', 'costPrice', 'cost_price', '成本', '进价'],
      // 快递公司
      carrier: ['快递公司', 'carrier', '物流公司', '承运商'],
    };

    // 提取字段值
    const getFieldValue = (fieldNames: string[]): any => {
      for (const fieldName of fieldNames) {
        // 尝试直接匹配
        if (row[fieldName] !== undefined && row[fieldName] !== null && row[fieldName] !== '') {
          return row[fieldName];
        }
        // 尝试忽略大小写和空格
        const normalizedFieldName = fieldName.toLowerCase().replace(/\s+/g, '');
        for (const key in row) {
          const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
          if (normalizedKey === normalizedFieldName) {
            return row[key];
          }
        }
      }
      return null;
    };

    const orderNo = getFieldValue(fieldMap.orderNo);
    if (!orderNo) {
      throw new Error('订单号不能为空');
    }

    const openid = getFieldValue(fieldMap.openid) || '';
    const recipient = getFieldValue(fieldMap.recipient) || '';
    const phone = getFieldValue(fieldMap.phone) || '';
    const address = getFieldValue(fieldMap.address) || '';
    const modifiedAddress = getFieldValue(fieldMap.modifiedAddress) || null;
    const productName = getFieldValue(fieldMap.productName) || '';
    const quantity = parseInt(getFieldValue(fieldMap.quantity) || '1', 10) || 1;
    const price = parseFloat(getFieldValue(fieldMap.price) || '0') || 0;
    const points = parseInt(getFieldValue(fieldMap.points) || '0', 10) || 0;
    const statusStr = getFieldValue(fieldMap.status) || 'PENDING';
    const dateStr = getFieldValue(fieldMap.date);
    const notes = getFieldValue(fieldMap.notes) || null;
    const trackingNo = getFieldValue(fieldMap.trackingNo) || null;
    const costPrice = getFieldValue(fieldMap.costPrice)
      ? parseFloat(getFieldValue(fieldMap.costPrice))
      : null;
    const carrier = getFieldValue(fieldMap.carrier) || null;
    const shipmentNo = getFieldValue(fieldMap.shipmentNo) || null;

    // 解析日期
    let orderTime: Date;
    if (dateStr) {
      if (typeof dateStr === 'string') {
        // 尝试多种日期格式
        const parsedDate = new Date(dateStr);
        if (isNaN(parsedDate.getTime())) {
          // 尝试解析中文日期格式，如 "2025/11/17 12:24:06"
          const dateMatch = dateStr.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:\s+(\d{1,2}):(\d{1,2}):(\d{1,2}))?/);
          if (dateMatch) {
            const [, year, month, day, hour = '0', minute = '0', second = '0'] = dateMatch;
            orderTime = new Date(
              parseInt(year),
              parseInt(month) - 1,
              parseInt(day),
              parseInt(hour),
              parseInt(minute),
              parseInt(second),
            );
          } else {
            orderTime = new Date();
          }
        } else {
          orderTime = parsedDate;
        }
      } else if (dateStr instanceof Date) {
        orderTime = dateStr;
      } else {
        orderTime = new Date();
      }
    } else {
      orderTime = new Date();
    }

    // 状态映射
    const statusMap: { [key: string]: string } = {
      待处理: 'PENDING',
      处理中: 'PROCESSING',
      已发货: 'SHIPPED',
      已送达: 'DELIVERED',
      已取消: 'CANCELLED',
      PENDING: 'PENDING',
      PROCESSING: 'PROCESSING',
      SHIPPED: 'SHIPPED',
      DELIVERED: 'DELIVERED',
      CANCELLED: 'CANCELLED',
    };
    const status = statusMap[statusStr] || 'PENDING';

    // 查找或创建订单
    let order = await this.prisma.order.findUnique({
      where: { orderNo: String(orderNo) },
    });

    if (!order) {
      // 创建新订单
      order = await this.prisma.order.create({
        data: {
          orderNo: String(orderNo),
          orderTime,
          openid: String(openid),
          recipient: String(recipient),
          phone: String(phone),
          address: String(address),
          modifiedAddress,
          productName: String(productName),
          price,
          points,
          status: status as any,
          storeId: storeId || null,
        },
      });
    } else {
      // 更新现有订单
      order = await this.prisma.order.update({
        where: { orderNo: String(orderNo) },
        data: {
          orderTime: orderTime < order.orderTime ? orderTime : order.orderTime, // 保留最早的订单时间
          openid: openid || order.openid,
          recipient: recipient || order.recipient,
          phone: phone || order.phone,
          address: address || order.address,
          modifiedAddress: modifiedAddress || order.modifiedAddress,
          productName: productName || order.productName,
          price: price || Number(order.price),
          points: points || order.points,
          status: (status as any) || order.status,
          storeId: storeId || order.storeId,
        },
      });
    }

    // 如果有发货编号或快递单号，创建或更新发货单
    if (shipmentNo || trackingNo) {
      let shipment = shipmentNo
        ? await this.prisma.shipment.findUnique({
            where: { shipmentNo: String(shipmentNo) },
          })
        : null;

      if (!shipment) {
        // 创建新发货单
        shipment = await this.prisma.shipment.create({
          data: {
            shipmentNo: shipmentNo ? String(shipmentNo) : `SHIP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            orderId: order.id,
            trackingNo: trackingNo ? String(trackingNo) : null,
            carrier: carrier ? String(carrier) : null,
            status: trackingNo ? 'SHIPPED' : 'PENDING',
            shippedAt: trackingNo ? orderTime : null,
            source: 'SUPPLIER',
          },
        });
      } else {
        // 更新现有发货单
        shipment = await this.prisma.shipment.update({
          where: { id: shipment.id },
          data: {
            trackingNo: trackingNo ? String(trackingNo) : shipment.trackingNo,
            carrier: carrier ? String(carrier) : shipment.carrier,
            status: trackingNo ? 'SHIPPED' : shipment.status,
            shippedAt: trackingNo ? (shipment.shippedAt || orderTime) : shipment.shippedAt,
          },
        });
      }
    }

    // 如果有成本价，可能需要创建或更新RfqItem
    // 这里我们暂时不处理RfqItem，因为历史数据导入主要是订单和发货单
  }

  /**
   * 将订单数据中的照片 key 转换为可访问的 URL
   */
  private async convertPhotosToUrls(orders: any[], requestOrigin?: string): Promise<any[]> {
    return Promise.all(
      orders.map(async (order) => {
        if (order.shipments && Array.isArray(order.shipments)) {
          const shipmentsWithUrls = await Promise.all(
            order.shipments.map(async (shipment: any) => {
              if (shipment.packages && Array.isArray(shipment.packages)) {
                const packagesWithUrls = await Promise.all(
                  shipment.packages.map(async (pkg: any) => {
                    const updatedPkg: any = { ...pkg };
                    
                    // 转换 photos 数组
                    if (pkg.photos && Array.isArray(pkg.photos)) {
                      const photosWithUrls = await Promise.all(
                        pkg.photos.map(async (photo: string) => {
                          try {
                            // 如果已经是完整 URL，直接返回
                            if (photo.startsWith('http://') || photo.startsWith('https://')) {
                              return photo;
                            }
                            // 否则转换为签名 URL
                            return await this.storageService.getFileUrl(photo, 3600, requestOrigin);
                          } catch (error) {
                            this.logger.warn('转换照片 URL 失败', { photo, error });
                            return photo; // 转换失败时返回原值
                          }
                        })
                      );
                      updatedPkg.photos = photosWithUrls;
                    }
                    
                    // 转换 labelUrl（快递面单）
                    if (pkg.labelUrl) {
                      try {
                        this.logger.debug('转换快递面单 URL', { 
                          originalLabelUrl: pkg.labelUrl,
                          shipmentId: shipment.id,
                          packageId: pkg.id 
                        });
                        
                        // 如果已经是完整 URL，直接返回
                        if (pkg.labelUrl.startsWith('http://') || pkg.labelUrl.startsWith('https://')) {
                          updatedPkg.labelUrl = pkg.labelUrl;
                          this.logger.debug('面单 URL 已是完整 URL，无需转换');
                        } else {
                          // 否则转换为签名 URL
                          updatedPkg.labelUrl = await this.storageService.getFileUrl(pkg.labelUrl, 3600, requestOrigin);
                          this.logger.debug('面单 URL 转换成功', { 
                            convertedUrl: updatedPkg.labelUrl.substring(0, 100) + '...' 
                          });
                        }
                      } catch (error) {
                        this.logger.warn('转换面单 URL 失败', { 
                          labelUrl: pkg.labelUrl, 
                          error: error instanceof Error ? error.message : String(error),
                          shipmentId: shipment.id,
                          packageId: pkg.id
                        });
                        updatedPkg.labelUrl = pkg.labelUrl; // 转换失败时返回原值
                      }
                    } else {
                      this.logger.debug('包裹没有 labelUrl', { 
                        packageId: pkg.id,
                        shipmentId: shipment.id,
                        hasPhotos: !!pkg.photos
                      });
                    }
                    
                    return updatedPkg;
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
          return {
            ...order,
            shipments: shipmentsWithUrls,
          };
        }
        return order;
      })
    );
  }
}

