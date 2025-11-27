import { Injectable, Inject, forwardRef, BadRequestException, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { DingTalkService } from '../dingtalk/dingtalk.service';
import { AuctionQueue } from '../../queues/auction.queue';
import * as XLSX from 'xlsx';
import * as csv from 'csv-parse/sync';
import { RfqWhereCondition } from '../../common/types/rfq.types';
import { Prisma, RfqStatus, RfqType } from '@prisma/client';
import type { RfqFindAllFilters, UnquotedItem } from './types/rfq-response.types';

interface ParsedRfqItem {
  productName: string;
  quantity: number;
  unit?: string;
  description?: string;
  notes?: string;
  orderNo?: string;
  maxPrice?: number; // 最高限价
  instantPrice?: number; // 一口价
}

interface ParsedOrder {
  orderNo: string;
  orderTime: Date;
  openid: string;
  recipient: string;
  phone: string;
  address: string;
  productName: string;
  price: number;
  points?: number;
  userNickname?: string | null;
  modifiedAddress?: string | null;
}

@Injectable()
export class RfqService {
  private readonly logger = new Logger(RfqService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationService: NotificationService,
    @Inject(forwardRef(() => AuctionQueue)) private auctionQueue: AuctionQueue,
    @Optional() private dingTalkService?: DingTalkService,
  ) {}

  /**
   * 数据脱敏：供应商未中标/未协商前隐藏敏感信息
   * @param order 订单数据
   * @param supplierId 供应商ID（如果提供，检查是否已中标）
   * @param rfqId 询价单ID（用于检查中标状态）
   */
  private async maskSensitiveOrderData(
    order: any,
    supplierId?: string,
    rfqId?: string
  ): Promise<any> {
    if (!order) return order;

    // 如果没有供应商ID，说明是采购员/管理员查看，显示完整信息
    if (!supplierId) {
      return order;
    }

    // 检查供应商是否已中标
    let isAwarded = false;
    if (rfqId && supplierId) {
      const award = await this.prisma.award.findFirst({
        where: {
          rfqId,
          supplierId,
          status: { not: 'CANCELLED' },
        },
      });
      isAwarded = !!award;
    }

    // 如果已中标，显示完整信息；否则脱敏
    if (isAwarded) {
      return order;
    }

    // 脱敏处理 - 返回订单对象，只修改敏感字段
    return {
      ...order,
      openid: order.openid ? `${order.openid.substring(0, 4)}****${order.openid.substring(order.openid.length - 4)}` : order.openid,
      phone: order.phone ? `${order.phone.substring(0, 3)}****${order.phone.substring(order.phone.length - 4)}` : order.phone,
      address: order.address ? `${order.address.substring(0, 6)}****` : order.address,
      recipient: order.recipient ? `${order.recipient.substring(0, 1)}**` : order.recipient,
    };
  }

  async create(createRfqDto: CreateRfqDto, userId: string, userRole?: string, userStoreId?: string) {
    try {
      // 获取用户信息（用于验证门店权限）
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, storeId: true },
      });

      // 门店用户只能为自己的门店创建询价单，自动设置为自己的门店ID
      if (user?.role === 'STORE' && user.storeId) {
        createRfqDto.storeId = user.storeId;
        this.logger.debug('门店用户创建询价单，自动设置为自己的门店', { storeId: user.storeId });
      }

      // 验证门店ID必填
      if (!createRfqDto.storeId || createRfqDto.storeId.trim() === '') {
        throw new BadRequestException('关联门店不能为空，请选择门店');
      }

      // 验证门店是否存在
      const store = await this.prisma.store.findUnique({
        where: { id: createRfqDto.storeId },
      });
      if (!store) {
        throw new BadRequestException('所选门店不存在');
      }

      // 门店用户只能为自己的门店创建询价单
      if (user?.role === 'STORE' && user.storeId !== createRfqDto.storeId) {
        throw new BadRequestException('门店用户只能为自己的门店创建询价单');
      }

    // 确保截止时间是未来时间
    const deadline = new Date(createRfqDto.deadline);
    const now = new Date();
    
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('创建询价单', {
        deadline: deadline.toISOString(),
        now: now.toISOString(),
        timeDiffHours: (deadline.getTime() - now.getTime()) / (1000 * 60 * 60),
      });
    }
    
      if (deadline <= now) {
        throw new BadRequestException('截止时间必须是未来时间');
      }
      
      // 如果标题为空或格式为"店铺名称+日期"（缺少序号），自动生成标题：店铺名称+日期+序号
      let finalTitle = createRfqDto.title;
      if (user?.role === 'STORE' && store) {
        const today = new Date();
        const dateStr = today.toLocaleDateString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).replace(/\//g, '-');
        
        // 检查标题是否为空，或者是"店铺名称+日期"格式（缺少序号）
        const expectedPrefix = `${store.name} ${dateStr}`;
        const shouldAutoGenerate = 
          !finalTitle || 
          finalTitle.trim() === '' || 
          finalTitle.trim() === expectedPrefix ||
          finalTitle.trim().startsWith(expectedPrefix + ' ');
        
        if (shouldAutoGenerate) {
          // 查询今天该店铺创建的询价单数量（用于生成序号）
          const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
          
          const todayRfqCount = await this.prisma.rfq.count({
            where: {
              storeId: store.id,
              createdAt: {
                gte: startOfDay,
                lte: endOfDay,
              },
            },
          });
          
          const sequenceNumber = todayRfqCount + 1;
          finalTitle = `${store.name} ${dateStr} ${sequenceNumber}`;
          
          this.logger.debug('自动生成询价单标题', {
            storeName: store.name,
            dateStr,
            sequenceNumber,
            finalTitle,
            originalTitle: createRfqDto.title,
          });
        }
      }
      
      const rfq = await this.prisma.rfq.create({
      data: {
        rfqNo: `RFQ-${Date.now()}`,
          title: finalTitle,
        description: createRfqDto.description,
        type: createRfqDto.type as any,
        deadline: deadline,
        status: 'DRAFT', // 创建时默认为草稿状态，需要设置完最高限价后才能发布
        buyerId: userId,
        storeId: createRfqDto.storeId,
      },
    });
    
    this.logger.log(`询价单创建成功: ${rfq.rfqNo}`, {
      id: rfq.id,
      rfqNo: rfq.rfqNo,
      status: rfq.status,
    });

    // 关联订单
    if (createRfqDto.orderIds && createRfqDto.orderIds.length > 0) {
      try {
        await this.prisma.orderRfq.createMany({
          data: createRfqDto.orderIds.map(orderId => ({
            orderId,
            rfqId: rfq.id,
          })),
        });
      } catch (orderError) {
        const errorMessage = orderError instanceof Error ? orderError.message : String(orderError);
        this.logger.error('关联订单失败', {
          rfqId: rfq.id,
          orderIds: createRfqDto.orderIds,
          error: errorMessage,
        });
        // 关联订单失败不影响询价单创建，记录错误但继续
      }
    }

    // 创建询价单商品明细
    if (createRfqDto.items && createRfqDto.items.length > 0) {
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('创建询价单商品明细', {
          rfqId: rfq.id,
          itemsCount: createRfqDto.items.length,
        });
      }
      
      const itemsToCreate = createRfqDto.items.map(item => ({
        rfqId: rfq.id,
        productName: item.productName,
        quantity: item.quantity || 1,
        unit: item.unit,
        description: item.description,
        notes: item.notes,
        maxPrice: item.maxPrice ? Number(item.maxPrice) : null, // 最高限价
        instantPrice: item.instantPrice ? Number(item.instantPrice) : null, // 一口价
        orderNo: (item as any).orderNo || null, // 保存订单号
      }));
      
      const createdItems = await this.prisma.rfqItem.createMany({
        data: itemsToCreate,
      });
      
      this.logger.log(`询价单商品明细创建成功: ${createdItems.count} 个商品`, {
        rfqId: rfq.id,
        itemsCount: createdItems.count,
      });
    } else {
      this.logger.warn('询价单创建时没有提供商品明细', {
        rfqId: rfq.id,
        hasItems: !!createRfqDto.items,
      });
    }

    // 记录审计日志（失败不影响主流程）
    try {
      await this.auditService.log({
        action: 'rfq.create',
        resource: 'Rfq',
        resourceId: rfq.id,
        userId,
      });
    } catch (auditError) {
      const errorMessage = auditError instanceof Error ? auditError.message : String(auditError);
      this.logger.warn('记录审计日志失败', {
        rfqId: rfq.id,
        userId,
        error: errorMessage,
      });
      // 审计日志失败不影响主流程
    }

    // 添加截标任务（失败不影响主流程）
    if (rfq.status === 'PUBLISHED') {
      try {
        await this.auctionQueue.addCloseJob(rfq.id, new Date(rfq.deadline));
      } catch (queueError) {
        const errorMessage = queueError instanceof Error ? queueError.message : String(queueError);
        this.logger.error('添加截标任务失败', {
          rfqId: rfq.id,
          deadline: rfq.deadline,
          error: errorMessage,
        });
        // 队列任务失败不影响询价单创建，但需要记录错误
      }
    }

    // 重新查询询价单，包含商品明细
    const rfqWithItems = await this.prisma.rfq.findUnique({
      where: { id: rfq.id },
      include: {
        items: true,
        store: true,
        buyer: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('返回的询价单（包含商品明细）', {
          id: rfqWithItems?.id,
          rfqNo: rfqWithItems?.rfqNo,
          itemsCount: rfqWithItems?.items?.length || 0,
        });
      }

      return rfqWithItems || rfq;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('创建询价单失败', {
        userId,
        storeId: createRfqDto.storeId,
        title: createRfqDto.title,
        itemsCount: createRfqDto.items?.length || 0,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      // 如果是已知的业务异常，直接抛出
      if (error instanceof BadRequestException) {
        throw error;
      }

      // 根据错误类型提供更具体的错误信息
      if (errorMessage.includes('Unique constraint') || errorMessage.includes('唯一约束')) {
        throw new BadRequestException('创建询价单失败：数据冲突，请稍后重试');
      }
      if (errorMessage.includes('Foreign key') || errorMessage.includes('外键')) {
        throw new BadRequestException('创建询价单失败：关联数据不存在，请检查门店和订单信息');
      }

      throw new BadRequestException(`创建询价单失败：${errorMessage}`);
    }
  }

  /**
   * 获取当天某个店铺已创建的询价单数量（用于计算序号）
   */
  async getTodayRfqCount(storeId: string): Promise<number> {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    
    const count = await this.prisma.rfq.count({
      where: {
        storeId: storeId,
        createdAt: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
    });
    
    return count;
  }

  async createFromFile(file: Express.Multer.File, createRfqDto: CreateRfqDto, userId: string) {
    try {
      // 验证文件
      if (!file || !file.buffer) {
        throw new BadRequestException('文件不能为空');
      }

      // 验证文件大小（限制为 10MB）
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.size > maxSize) {
        throw new BadRequestException(`文件大小不能超过 ${maxSize / 1024 / 1024}MB`);
      }

      // 解析文件，提取商品信息和订单信息
      this.logger.debug('开始解析文件', { 
        filename: file.originalname, 
        size: file.size 
      });
      const { items, orders } = await this.parseFileForRfq(file);
    this.logger.debug('文件解析结果', { 
      itemsCount: items.length, 
      ordersCount: orders.length 
    });
    if (items.length > 0) {
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('前3个商品示例', { 
          items: items.slice(0, 3).map(item => ({
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit,
            orderNo: item.orderNo,
          }))
        });
      }
    } else {
      this.logger.warn('文件解析后没有提取到任何商品');
    }
    
    // 如果没有提供商品明细，使用解析的文件数据
    if (!createRfqDto.items || createRfqDto.items.length === 0) {
      createRfqDto.items = items;
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('使用文件解析的商品明细', { itemsCount: createRfqDto.items.length });
      }
    } else {
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('使用提供的商品明细', { itemsCount: createRfqDto.items.length });
      }
    }

    // 如果没有提供标题，使用文件名
    if (!createRfqDto.title) {
      createRfqDto.title = `询价单-${file.originalname.replace(/\.[^/.]+$/, '')}`;
    }

    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('准备创建询价单', { itemsCount: createRfqDto.items?.length || 0 });
    }
    
    // 创建询价单
    const result = await this.create(createRfqDto, userId);
    const rfqId = (result as any).id;
    
    // 创建或更新订单，并关联到询价单
    if (orders.length > 0) {
      this.logger.debug('开始创建/更新订单', { ordersCount: orders.length });
      const orderIds: string[] = [];
      const failedOrders: Array<{ orderNo: string; error: string }> = [];
      
      for (const orderData of orders) {
        try {
          // 验证订单数据
          if (!orderData.orderNo || orderData.orderNo.trim() === '') {
            this.logger.warn('跳过无效订单（缺少订单号）', { orderData });
            failedOrders.push({ orderNo: '未知', error: '缺少订单号' });
            continue;
          }

          // 查找或创建订单
          let order = await this.prisma.order.findUnique({
            where: { orderNo: orderData.orderNo },
          });
          
          if (!order) {
            // 创建新订单
            order = await this.prisma.order.create({
              data: {
                orderNo: orderData.orderNo,
                orderTime: orderData.orderTime,
                userNickname: orderData.userNickname,
                openid: orderData.openid,
                recipient: orderData.recipient,
                phone: orderData.phone,
                address: orderData.address,
                modifiedAddress: orderData.modifiedAddress,
                productName: orderData.productName,
                price: orderData.price,
                points: orderData.points,
                status: 'PENDING',
              },
            });
            this.logger.debug('创建新订单', { orderNo: order.orderNo });
          } else {
            // 更新现有订单（如果字段有变化）
            order = await this.prisma.order.update({
              where: { orderNo: orderData.orderNo },
              data: {
                userNickname: orderData.userNickname || order.userNickname,
                modifiedAddress: orderData.modifiedAddress || order.modifiedAddress,
                // 其他字段也可以更新
              },
            });
            if (process.env.NODE_ENV === 'development') {
              this.logger.debug('更新现有订单', { orderNo: order.orderNo });
            }
          }
          
          orderIds.push(order.id);
          
          // 关联订单到询价单（如果还没有关联）
          try {
            const existingRelation = await this.prisma.orderRfq.findUnique({
              where: {
                orderId_rfqId: {
                  orderId: order.id,
                  rfqId: rfqId,
                },
              },
            });
            
            if (!existingRelation) {
              await this.prisma.orderRfq.create({
                data: {
                  orderId: order.id,
                  rfqId: rfqId,
                },
              });
              if (process.env.NODE_ENV === 'development') {
                this.logger.debug('关联订单到询价单', { orderNo: order.orderNo, rfqId });
              }
            }
          } catch (relationError) {
            const errorMessage = relationError instanceof Error ? relationError.message : String(relationError);
            this.logger.error('关联订单到询价单失败', {
              orderNo: order.orderNo,
              rfqId,
              error: errorMessage,
            });
            // 关联失败不影响主流程，记录错误但继续
          }
        } catch (orderError) {
          const errorMessage = orderError instanceof Error ? orderError.message : String(orderError);
          const errorStack = orderError instanceof Error ? orderError.stack : undefined;
          this.logger.error('处理订单失败', {
            orderNo: orderData.orderNo,
            error: errorMessage,
            stack: errorStack,
            errorType: orderError?.constructor?.name,
          });
          failedOrders.push({ orderNo: orderData.orderNo, error: errorMessage });
          // 继续处理其他订单，不中断整个流程
        }
      }
      
      this.logger.log(`订单创建/更新完成: ${orderIds.length} 个订单成功，${failedOrders.length} 个失败`, {
        successCount: orderIds.length,
        failedCount: failedOrders.length,
        failedOrders: failedOrders.length > 0 ? failedOrders : undefined,
      });

      // 如果有订单处理失败，记录警告但不抛出异常（部分成功）
      if (failedOrders.length > 0) {
        this.logger.warn('部分订单处理失败', {
          totalOrders: orders.length,
          successCount: orderIds.length,
          failedCount: failedOrders.length,
          failedOrders,
        });
      }
    }
    
    this.logger.log('询价单创建完成', { 
      rfqId: (result as any)?.id,
      itemsCount: (result as any)?.items?.length || 0 
    });
    
    // 重新查询询价单，包含关联的订单
    const rfqWithOrders = await this.prisma.rfq.findUnique({
      where: { id: rfqId },
      include: {
        items: true,
        orders: {
          include: {
            order: true,
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
    });
    
      return rfqWithOrders || result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('从文件创建询价单失败', {
        filename: file?.originalname,
        fileSize: file?.size,
        userId,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });

      // 如果是已知的业务异常，直接抛出
      if (error instanceof BadRequestException) {
        throw error;
      }

      // 根据错误类型提供更具体的错误信息
      if (errorMessage.includes('文件格式') || errorMessage.includes('不支持')) {
        throw new BadRequestException(`文件格式错误：${errorMessage}`);
      }
      if (errorMessage.includes('文件大小') || errorMessage.includes('size')) {
        throw new BadRequestException(`文件过大：${errorMessage}`);
      }
      if (errorMessage.includes('解析') || errorMessage.includes('parse')) {
        throw new BadRequestException(`文件解析失败：请检查文件格式是否正确，确保包含必要的列（商品名称、订单号等）`);
      }

      // 其他未知错误
      throw new BadRequestException(`从文件创建询价单失败：${errorMessage}。请检查文件格式是否正确`);
    }
  }

  private async parseFileForRfq(file: Express.Multer.File): Promise<{
    items: ParsedRfqItem[];
    orders: ParsedOrder[];
  }> {
    try {
      const ext = file.originalname.split('.').pop()?.toLowerCase();
      let rows: Record<string, unknown>[] = [];

      this.logger.debug('开始解析文件', { ext, size: file.size });

      if (!ext) {
        throw new BadRequestException('文件缺少扩展名，无法识别文件格式');
      }

      if (ext === 'xlsx' || ext === 'xls') {
        try {
          this.logger.debug('解析 Excel 文件');
          const workbook = XLSX.read(file.buffer, { type: 'buffer' });
          
          if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
            throw new BadRequestException('Excel 文件不包含任何工作表');
          }
          
          const sheetName = workbook.SheetNames[0];
          this.logger.debug('工作表名称', { sheetName });
          const worksheet = workbook.Sheets[sheetName];
          
          if (!worksheet) {
            throw new BadRequestException(`无法读取工作表 "${sheetName}"`);
          }
          
          rows = XLSX.utils.sheet_to_json(worksheet);
          this.logger.debug('Excel 解析结果', { rowsCount: rows.length });
          if (rows.length > 0 && process.env.NODE_ENV === 'development') {
            this.logger.debug('第一行数据示例', { firstRow: rows[0] });
          }
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
          this.logger.debug('解析 CSV 文件');
          rows = csv.parse(file.buffer.toString(), {
            columns: true,
            skip_empty_lines: true,
            encoding: 'utf8',
          });
          this.logger.debug('CSV 解析结果', { rowsCount: rows.length });
          if (rows.length > 0 && process.env.NODE_ENV === 'development') {
            this.logger.debug('第一行数据示例', { firstRow: rows[0] });
          }
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

    // 转换为询价单商品明细和订单信息
    const items: ParsedRfqItem[] = [];
    const ordersMap = new Map<string, ParsedOrder>(); // 用订单号作为key，避免重复创建订单
    
    this.logger.debug('开始转换商品明细和订单信息', { rowsCount: rows.length });
    for (const row of rows) {
      const getField = (possibleNames: string[]): string | undefined => {
        for (const name of possibleNames) {
          const value = row[name];
          if (value !== undefined && value !== null && value !== '') {
            return String(value);
          }
          // 尝试大小写变体
          const lowerName = name.toLowerCase();
          for (const key of Object.keys(row)) {
            if (key.toLowerCase() === lowerName) {
              const foundValue = row[key];
              if (foundValue !== undefined && foundValue !== null && foundValue !== '') {
                return String(foundValue);
              }
            }
          }
        }
        return undefined;
      };

      // 提取订单信息
      const orderNo = getField([
        '订单号', 'orderNo', '订单编号', '订单ID', 'orderId', '订单', '编号', 
        '订单号', '订单编号', '订单单号', '单号', 'order_no', 'ORDER_NO'
      ]);
      
      const orderTimeRaw = getField([
        '订单时间', 'orderTime', '时间', '下单时间', '创建时间', 'createTime', 
        '日期', 'date', '订单日期', '下单日期', 'order_time', 'ORDER_TIME'
      ]);
      let orderTime: Date;
      if (orderTimeRaw) {
        try {
          orderTime = new Date(orderTimeRaw);
          if (isNaN(orderTime.getTime())) {
            orderTime = new Date();
          }
        } catch {
          orderTime = new Date();
        }
      } else {
        orderTime = new Date();
      }
      
      const userNickname = getField([
        '用户昵称', 'userNickname', 'nickname', '昵称', '用户名', 'username',
        '用户名称', '用户昵称', 'nick_name', 'USER_NICKNAME'
      ]);
      
      const openid = getField([
        'openid', 'OpenID', 'openId', '用户ID', 'userId', '用户标识', 
        '用户openid', 'open_id', 'OPEN_ID', '用户openid'
      ]) || `openid-${Date.now()}`;
      
      const recipient = getField([
        '收货人', 'recipient', '姓名', '收件人', '收货人姓名', 'name', 
        '联系人', '联系人姓名', '收货人', '收件人', '姓名'
      ]);
      
      const phone = getField([
        '电话', 'phone', '手机', '联系电话', '手机号', 'mobile', 
        '联系方式', '联系电话', '手机号码', 'phone_number', 'PHONE'
      ]);
      
      const address = getField([
        '地址', 'address', '收货地址', '详细地址', 'deliveryAddress', 
        '配送地址', '地址详情', '收货地址', '详细地址', 'address'
      ]);
      
      const modifiedAddress = getField([
        '修改地址', 'modifiedAddress', '修改后的地址', '新地址', 'updatedAddress',
        '地址修改', '修改地址', 'modified_address', 'MODIFIED_ADDRESS'
      ]);
      
      const productName = getField([
        '物品名称', '商品名称', 'productName', '商品名', '产品名称', '产品名', 
        'product_name', 'PRODUCT_NAME', '名称', 'name', '物品名'
      ]);

      if (!productName) {
        continue; // 跳过没有商品名称的行
      }

      const quantity = getField([
        '物品数量', '数量', 'quantity', 'qty', 'QUANTITY', 'QTY', '商品数量'
      ]);

      const unit = getField([
        '单位', 'unit', 'Unit', 'UNIT', '计量单位'
      ]);

      const description = getField([
        '描述', 'description', 'Description', 'DESCRIPTION', 
        '商品描述', '产品描述', '备注', 'notes'
      ]);
      
      const priceRaw = getField([
        '价值', '价格', 'price', '金额', '单价', '总价', 'totalPrice', '商品价格', 
        '订单金额', '实付金额', '支付金额', 'price', 'PRICE', '金额'
      ]);
      const price = priceRaw ? parseFloat(String(priceRaw).replace(/[^\d.-]/g, '')) || 0 : 0;
      
      const pointsRaw = getField([
        '积分', 'points', '积分值', 'point', 'points', 'POINTS'
      ]);
      const points = pointsRaw ? parseInt(String(pointsRaw)) || 0 : 0;

      // 提取最高限价
      const maxPriceRaw = getField([
        '最高限价', 'maxPrice', 'max_price', 'MAX_PRICE', '限价', '最高价', '最高价格'
      ]);
      const maxPrice = maxPriceRaw ? parseFloat(String(maxPriceRaw).replace(/[^\d.-]/g, '')) || undefined : undefined;

      // 提取一口价
      const instantPriceRaw = getField([
        '一口价', 'instantPrice', 'instant_price', 'INSTANT_PRICE', '自动中标价', '直接中标价'
      ]);
      const instantPrice = instantPriceRaw ? parseFloat(String(instantPriceRaw).replace(/[^\d.-]/g, '')) || undefined : undefined;

      // 如果有订单号，创建或更新订单信息
      if (orderNo) {
        if (!ordersMap.has(orderNo)) {
          ordersMap.set(orderNo, {
            orderNo: String(orderNo),
            orderTime,
            userNickname: userNickname ? String(userNickname) : null,
            openid: String(openid),
            recipient: String(recipient || '未知'),
            phone: String(phone || ''),
            address: String(address || ''),
            modifiedAddress: modifiedAddress ? String(modifiedAddress) : null,
            productName: String(productName),
            price,
            points,
          });
        } else {
          // 如果订单已存在，更新价格和积分（累加）
          const existingOrder = ordersMap.get(orderNo);
          existingOrder.price = (existingOrder.price || 0) + price;
          existingOrder.points = (existingOrder.points || 0) + points;
        }
      }

      // 添加商品明细（包含订单号，用于后续关联）
      items.push({
        productName: String(productName),
        quantity: quantity ? parseInt(String(quantity)) || 1 : 1,
        unit: unit ? String(unit) : undefined,
        description: description ? String(description) : undefined,
        notes: description ? String(description) : undefined, // 备注也保存到notes
        orderNo: orderNo ? String(orderNo) : undefined, // 保存订单号，用于关联
        maxPrice: maxPrice, // 最高限价
        instantPrice: instantPrice, // 一口价
      });
    }

    const orders = Array.from(ordersMap.values());
    
    this.logger.debug('转换完成', { 
      itemsCount: items.length, 
      ordersCount: orders.length 
    });
    if (items.length > 0 && process.env.NODE_ENV === 'development') {
      this.logger.debug('前3个商品', { items: items.slice(0, 3) });
    }
    if (orders.length > 0 && process.env.NODE_ENV === 'development') {
      this.logger.debug('前3个订单', { orders: orders.slice(0, 3) });
    }
    
      if (items.length === 0) {
        this.logger.warn('没有提取到任何商品', { rowsCount: rows.length });
        if (rows.length > 0 && process.env.NODE_ENV === 'development') {
          this.logger.debug('第一行数据和键', { 
            firstRow: rows[0], 
            keys: Object.keys(rows[0]) 
          });
        }
        // 如果文件有数据但没有提取到商品，可能是列名不匹配
        if (rows.length > 0) {
          throw new BadRequestException(
            '文件解析后没有提取到任何商品。请确保文件包含"商品名称"或"productName"列，且数据格式正确'
          );
        }
      }

      return { items, orders };
    } catch (error) {
      // 如果是 BadRequestException，直接抛出
      if (error instanceof BadRequestException) {
        throw error;
      }
      
      // 其他错误包装为 BadRequestException
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('解析文件失败', {
        filename: file?.originalname,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new BadRequestException(`文件解析失败：${errorMessage}`);
    }
  }

  async findAll(filters?: RfqFindAllFilters): Promise<any[]> {
    const now = new Date();
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('findAll 查询条件', filters);
      this.logger.debug('当前时间', now.toISOString());
    }
    
    const where: Prisma.RfqWhereInput = {};
    
    // 只添加非空的过滤条件
    if (filters?.status) {
      where.status = filters.status as RfqStatus;
    }
    if (filters?.type) {
      where.type = filters.type as RfqType;
    }
    if (filters?.buyerId) {
      where.buyerId = filters.buyerId;
    }
    if (filters?.storeId) {
      where.storeId = filters.storeId;
    }
    
    // 如果未明确指定包含过期，且状态是PUBLISHED，则只返回未过期的
    // 注意：对于供应商查询，我们需要确保返回未过期的询价单
    if (filters?.includeExpired !== true && filters?.status === 'PUBLISHED') {
      where.deadline = { gt: now };
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('添加截止时间过滤条件', { 
          deadline: now.toISOString(), 
          timestamp: now.getTime(),
          deadlineType: typeof where.deadline 
        });
      }
    }
    
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('最终查询条件', { where: JSON.stringify(where, null, 2) });
    }
    
    const result = await this.prisma.rfq.findMany({
      where,
      include: {
        store: true,
        buyer: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        orders: {
          include: {
            order: true,
          },
        },
        items: true, // 包含商品明细
        quotes: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
          },
        },
        awards: {
          include: {
            quote: {
              include: {
                items: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    
    this.logger.debug('查询结果', { count: result.length });
    
    // 如果是供应商查询已发布的询价单，需要过滤掉那些有商品未设置最高限价的询价单
    if (filters?.status === 'PUBLISHED') {
      const filteredResult = result.filter((rfq) => {
        // 检查所有商品是否都设置了最高限价
        if (!rfq.items || rfq.items.length === 0) {
          return false; // 没有商品的询价单不显示给供应商
        }
        const allItemsHaveMaxPrice = rfq.items.every((item) => 
          item.maxPrice && Number(item.maxPrice) > 0
        );
        if (!allItemsHaveMaxPrice && process.env.NODE_ENV === 'development') {
          this.logger.debug('过滤掉询价单（有商品未设置最高限价）', { rfqNo: rfq.rfqNo });
        }
        return allItemsHaveMaxPrice;
      });
      
      this.logger.debug(`findAll: 过滤后结果 ${filteredResult.length} 个询价单（所有商品都设置了最高限价）`);
      
      if (filteredResult.length > 0 && process.env.NODE_ENV === 'development') {
        filteredResult.forEach((rfq) => {
          const deadline = new Date(rfq.deadline);
          const now = new Date();
          const isExpired = deadline <= now;
          const itemsCount = rfq.items?.length || 0;
          this.logger.debug('查询返回的询价单', {
            id: rfq.id,
            rfqNo: rfq.rfqNo,
            title: rfq.title,
            status: rfq.status,
            deadline: rfq.deadline,
            isExpired,
            itemsCount,
          });
        });
      }
      
      return filteredResult;
    }
    
    // 检查数据库中是否有询价单（用于调试）
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('检查数据库中的所有询价单');
    }
    const allRfqs = await this.prisma.rfq.findMany({
      select: {
        id: true,
        rfqNo: true,
        title: true,
        status: true,
        deadline: true,
        createdAt: true,
      },
      take: 20,
      orderBy: {
        createdAt: 'desc',
      },
    });
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(`数据库中的所有询价单（前20个）: ${allRfqs.length} 个`);
    }
    allRfqs.forEach((rfq) => {
      const deadline = new Date(rfq.deadline);
      const now = new Date();
      const isExpired = deadline <= now;
      const matchesStatus = !filters?.status || rfq.status === filters.status;
      const matchesDeadline = !filters?.status || filters.status !== 'PUBLISHED' || !where.deadline || deadline > now;
      const shouldBeIncluded = matchesStatus && matchesDeadline;
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('数据库中的询价单', {
          rfqNo: rfq.rfqNo,
          title: rfq.title,
          status: rfq.status,
          deadline: rfq.deadline,
          deadlineISO: deadline.toISOString(),
          createdAt: rfq.createdAt,
          isExpired,
          matchesStatus,
          matchesDeadline,
          shouldBeIncluded,
          timeDiff: deadline.getTime() - now.getTime(),
          timeDiffHours: ((deadline.getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(2),
        });
      }
    });
    
    return result;
  }

  async findOne(id: string, supplierId?: string, storeId?: string) {
    // 门店用户只能查看自己门店的询价单
    if (storeId) {
      const rfqCheck = await this.prisma.rfq.findUnique({
        where: { id },
        select: { storeId: true },
      });
      if (!rfqCheck || rfqCheck.storeId !== storeId) {
        throw new BadRequestException('无权访问此询价单');
      }
    }

    // 先查询RFQ基本信息，用于判断是否需要盲拍
    const rfqBasic = await this.prisma.rfq.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    const rfq = await this.prisma.rfq.findUnique({
      where: { id },
      include: {
        store: true,
        buyer: true,
        items: true, // 包含商品明细
        orders: {
          include: {
            order: {
              select: {
                id: true,
                orderNo: true,
                productName: true,
                price: true,
                openid: true,
                phone: true,
                address: true,
                recipient: true,
                modifiedAddress: true,
              },
            },
          },
        },
        quotes: {
          // 盲拍：截标前供应商只能看到自己的报价，截标后可以看到所有报价
          where: supplierId && rfqBasic && rfqBasic.status !== 'CLOSED' && rfqBasic.status !== 'AWARDED' 
            ? { supplierId } 
            : undefined,
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
            items: {
              include: {
                rfqItem: true,
              },
            },
          },
        },
        awards: {
          include: {
            quote: {
              include: {
                items: true,
              },
            },
          },
        },
      },
    });

    // 添加详细日志
    if (rfq) {
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('查询询价单详情', {
          id: rfq.id,
          rfqNo: rfq.rfqNo,
          title: rfq.title,
          itemsCount: rfq.items?.length || 0,
          hasItems: !!rfq.items,
          items: rfq.items?.map((item) => ({
            id: item.id,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit,
          })) || [],
        });
      }
      
      // 如果查询结果中没有 items，直接从数据库查询验证
      if (!rfq.items || rfq.items.length === 0) {
        const dbItems = await this.prisma.rfqItem.findMany({
          where: { rfqId: rfq.id },
        });
        this.logger.debug('直接从数据库查询的商品数量', { count: dbItems.length });
        if (dbItems.length > 0) {
          this.logger.warn('数据库中有商品，但查询结果中没有！可能是 Prisma include 的问题。', {
            rfqId: rfq.id,
            dbItemsCount: dbItems.length,
          });
          // 手动添加 items
          (rfq as any).items = dbItems;
        }
      }

      // 数据脱敏：如果供应商未中标，隐藏敏感信息
      if (supplierId && rfq.orders) {
        for (const orderRfq of rfq.orders) {
          if (orderRfq.order) {
            orderRfq.order = await this.maskSensitiveOrderData(orderRfq.order, supplierId, rfq.id);
          }
        }
      }
    }

    return rfq;
  }

  /**
   * 发布询价单（只有所有商品都设置了最高限价才能发布）
   */
  async publishRfq(id: string, userId: string) {
    const rfq = await this.prisma.rfq.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!rfq) {
      throw new BadRequestException('询价单不存在');
    }

    // 门店用户只能发布自己门店的询价单
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, storeId: true },
    });

    if (user?.role === 'STORE' && user.storeId && rfq.storeId !== user.storeId) {
      throw new BadRequestException('门店用户只能发布自己门店的询价单');
    }

    if (rfq.status !== 'DRAFT') {
      throw new BadRequestException('只有草稿状态的询价单才能发布');
    }

    // 验证所有商品都设置了最高限价
    if (!rfq.items || rfq.items.length === 0) {
      throw new BadRequestException('询价单没有商品，无法发布');
    }

    const itemsWithoutMaxPrice = rfq.items.filter(item => !item.maxPrice || Number(item.maxPrice) <= 0);
    if (itemsWithoutMaxPrice.length > 0) {
      const itemNames = itemsWithoutMaxPrice.map(item => item.productName).join('、');
      throw new BadRequestException(
        `以下 ${itemsWithoutMaxPrice.length} 个商品未设置最高限价，请先设置后再发布：${itemNames}`
      );
    }

    // 更新状态为已发布
    const updated = await this.prisma.rfq.update({
      where: { id },
      data: {
        status: 'PUBLISHED',
      },
    });

    // 如果询价单是已发布状态，添加关闭任务
    if (updated.status === 'PUBLISHED') {
      await this.auctionQueue.addCloseJob(updated.id, new Date(updated.deadline));
    }

    // 记录审计日志
    await this.auditService.log({
      userId,
      action: 'RFQ_PUBLISH',
      resource: 'Rfq',
      resourceId: id,
      details: {
        rfqNo: rfq.rfqNo,
        itemsCount: rfq.items.length,
      },
    });

    // 通知所有供应商有新询价单发布
    const suppliers = await this.prisma.user.findMany({
      where: {
        role: 'SUPPLIER',
        status: 'ACTIVE',
      },
      select: {
        id: true,
        username: true,
      },
    });

    const itemNames = rfq.items.map(item => item.productName).join('、');
    const itemCount = rfq.items.length;

    // 获取发布人信息
    const publisher = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    // 为每个供应商创建通知（不发送钉钉，避免重复）
    for (const supplier of suppliers) {
      await this.notificationService.create({
        userId: supplier.id,
        type: 'RFQ_PUBLISHED',
        title: '新询价单发布',
        content: `询价单 ${rfq.rfqNo} 已发布，包含 ${itemCount} 个商品：${itemNames}，截止时间：${new Date(rfq.deadline).toLocaleString('zh-CN')}`,
        link: `/rfqs/${id}`,
        userName: supplier.username || undefined,
        sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
      });
    }

    // 通知所有管理员（创建系统内通知，但不发送钉钉）
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, username: true },
    });

    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: 'RFQ_PUBLISHED',
        title: '询价单已发布',
        content: `询价单 ${rfq.rfqNo} 已发布，包含 ${itemCount} 个商品：${itemNames}，截止时间：${new Date(rfq.deadline).toLocaleString('zh-CN')}，发布人：${publisher?.username || '未知'}`,
        link: `/rfqs/${id}`,
        userName: admin.username || undefined,
        sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
      });
    }

    // 发送一条汇总的钉钉消息到群里（避免重复）
    if (this.dingTalkService) {
      const dingTalkContent = `询价单 ${rfq.rfqNo} 已发布，包含 ${itemCount} 个商品：${itemNames}，截止时间：${new Date(rfq.deadline).toLocaleString('zh-CN')}，发布人：${publisher?.username || '未知'}`;
      this.logger.debug(`[RFQService] 发送汇总钉钉通知: 询价单 ${rfq.rfqNo}`);
      this.dingTalkService
        .sendNotification({
          type: 'RFQ_PUBLISHED',
          title: '新询价单发布',
          content: dingTalkContent,
          link: `/rfqs/${id}`,
          userName: '系统',
        })
        .catch((error) => {
          this.logger.error('[RFQService] 钉钉通知发送失败:', error);
        });
    }

    this.logger.debug(`已通知 ${suppliers.length} 个供应商和 ${admins.length} 个管理员关于询价单 ${rfq.rfqNo} 的发布`);

    return updated;
  }

  async closeRfq(id: string, userId?: string) {
    // 关闭询价单
    const rfqBefore = await this.prisma.rfq.findUnique({
      where: { id },
      select: { rfqNo: true, status: true, storeId: true },
    });

    // 门店用户只能关闭自己门店的询价单
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, storeId: true },
      });

      if (user?.role === 'STORE' && user.storeId && rfqBefore?.storeId !== user.storeId) {
        throw new BadRequestException('门店用户只能关闭自己门店的询价单');
      }
    }

    const rfq = await this.prisma.rfq.update({
      where: { id },
      data: {
        status: 'CLOSED',
        closeTime: new Date(),
      },
      include: {
        items: true,
        quotes: {
          // 查询所有状态的报价（除了 REJECTED），因为任何报价都表示该商品有供应商报价
          where: { status: { not: 'REJECTED' } },
          include: {
            items: true,
          },
        },
        orders: {
          include: {
            order: {
              select: {
                id: true,
                orderNo: true,
                orderTime: true,
                recipient: true,
                phone: true,
                address: true,
              },
            },
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

    // 检查未报价的商品并通知采购员
    // 获取所有已报价的商品ID（包括所有状态的报价，除了 REJECTED）
    const quotedItemIds = new Set(
      rfq.quotes.flatMap((quote) => quote.items.map((item) => item.rfqItemId))
    );
    const unquotedItems = rfq.items.filter((item) => !quotedItemIds.has(item.id));

    this.logger.debug('关闭询价单统计', {
      rfqNo: rfq.rfqNo,
      totalItems: rfq.items.length,
      quotesCount: rfq.quotes.length,
      quotedItemsCount: quotedItemIds.size,
      unquotedItemsCount: unquotedItems.length,
    });

    if (unquotedItems.length > 0) {
      // 获取询价单关联的订单信息
      const rfqWithOrders = await this.prisma.rfq.findUnique({
        where: { id: rfq.id },
        include: {
          orders: {
            include: {
              order: {
                select: {
                  orderNo: true,
                  orderTime: true,
                  recipient: true,
                  phone: true,
                  address: true,
                },
              },
            },
          },
        },
      });

      // 构建通知内容，包含订单信息
      const unquotedItemDetails = unquotedItems.map((item) => {
        const orderInfo = rfqWithOrders?.orders?.[0]?.order;
        if (orderInfo) {
          return `${item.productName} × ${item.quantity}${item.unit || '件'}（订单号：${orderInfo.orderNo}，收件人：${orderInfo.recipient}，手机：${orderInfo.phone}，地址：${orderInfo.address}）`;
        }
        return `${item.productName} × ${item.quantity}${item.unit || '件'}`;
      });

      const unquotedItemNames = unquotedItemDetails.join('、');

      // 通知采购员（如果buyerId是管理员，需要找到实际的采购员）
      try {
        // 获取询价单的buyer信息
        const buyer = rfq.buyer;
        this.logger.debug('询价单buyer信息', {
          rfqNo: rfq.rfqNo,
          buyerId: buyer.id,
          username: buyer.username,
          email: buyer.email,
        });

        // 如果buyer是管理员，需要找到所有采购员并通知他们
        // 否则只通知buyer
        let userIdsToNotify = [rfq.buyerId];
        
        if (buyer && (buyer as any).role === 'ADMIN') {
          // 如果是管理员创建的询价单，通知所有采购员
          const buyers = await this.prisma.user.findMany({
            where: { role: 'BUYER' },
            select: { id: true },
          });
          userIdsToNotify = buyers.map(b => b.id);
          this.logger.debug('询价单由管理员创建，将通知所有采购员', { count: userIdsToNotify.length });
        }

        // 获取用户信息（用于钉钉通知）
        const users = await this.prisma.user.findMany({
          where: { id: { in: userIdsToNotify } },
          select: { id: true, username: true },
        });
        const userMap = new Map(users.map(u => [u.id, u.username]));

        // 为每个用户创建通知
        const notifications = await Promise.all(
          userIdsToNotify.map(userId =>
            this.notificationService.create({
              userId,
              type: 'RFQ_UNQUOTED_ITEMS',
              title: '询价单有未报价商品',
              content: `询价单 ${rfq.rfqNo} 已关闭，以下 ${unquotedItems.length} 个商品没有供应商报价，需要在拼多多/淘宝采购：${unquotedItemNames}`,
              link: `/purchase`,
              userName: userMap.get(userId) || undefined,
            })
          )
        );
        this.logger.log('询价单关闭，已通知用户', {
          rfqNo: rfq.rfqNo,
          unquotedItemsCount: unquotedItems.length,
          notificationsCount: notifications.length,
        });
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        this.logger.error('创建通知失败', {
          error,
          message: errorMessage,
          stack: errorStack,
          buyerId: rfq.buyerId,
          type: 'RFQ_UNQUOTED_ITEMS',
        });
        // 即使通知创建失败，也不应该阻止关闭询价单
      }
    }

    // 如果有报价，触发评标任务
    if (rfq.quotes.length > 0) {
      await this.auctionQueue.addEvaluateJob(id);
    }

    // 记录审计日志
    if (rfqBefore) {
      await this.auditService.log({
        userId: userId || 'SYSTEM', // 系统自动关闭时使用SYSTEM
        action: 'rfq.close',
        resource: 'Rfq',
        resourceId: id,
        details: {
          rfqNo: rfqBefore.rfqNo,
          previousStatus: rfqBefore.status,
          newStatus: 'CLOSED',
          quotesCount: rfq.quotes.length,
        },
      });
    }

    return rfq;
  }

  /**
   * 查找所有未报价的商品（需要从电商平台采购）
   */
  async findUnquotedItems(buyerId?: string, userRole?: string, storeId?: string): Promise<UnquotedItem[]> {
    try {
      // 管理员和采购员都可以看到所有询价单的未报价商品
      // 因为询价单可能是管理员创建的，采购员需要能看到这些未报价商品
      const whereCondition: Prisma.RfqWhereInput = {
        status: { in: ['CLOSED', 'AWARDED'] },
      };
      
      // 门店用户只能看到自己门店的未报价商品
      if (storeId) {
        whereCondition.storeId = storeId;
      }
      
      // 不按buyerId过滤，显示所有询价单的未报价商品
      // 这样采购员也能看到管理员创建的询价单的未报价商品
      
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('查找未报价商品', {
          whereCondition,
          buyerId,
          userRole,
        });
      }

      // 查找所有已截标的询价单，包含关联的订单信息
      const rfqs = await this.prisma.rfq.findMany({
      where: whereCondition,
      include: {
        items: {
          include: {
            shipments: {
              select: {
                id: true,
                source: true,
                trackingNo: true,
              },
            },
          },
        },
        quotes: {
          // 查询所有状态的报价（除了 REJECTED），因为任何报价都表示该商品有供应商报价
          where: { status: { not: 'REJECTED' } },
          include: {
            items: true,
          },
        },
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
            },
          },
        },
      },
    });

    if (process.env.NODE_ENV === 'development') {
      this.logger.debug(`查询到 ${rfqs.length} 个已截标的询价单`);
    }

    const unquotedItems: UnquotedItem[] = [];

    for (const rfq of rfqs) {
      // 获取所有已报价的商品ID（包括所有状态的报价，除了 REJECTED）
      const quotedItemIds = new Set(
        rfq.quotes.flatMap((quote) => quote.items.map((item) => item.rfqItemId))
      );

      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('查找未报价商品', {
          rfqNo: rfq.rfqNo,
          itemsCount: rfq.items.length,
          quotesCount: rfq.quotes.length,
          quotedItemsCount: quotedItemIds.size,
          ordersCount: rfq.orders.length,
        });
      }

      // 获取询价单关联的所有订单信息
      const orderInfos = rfq.orders.map((or) => ({
        orderNo: or.order.orderNo,
        orderTime: or.order.orderTime,
        userNickname: or.order.userNickname,
        openid: or.order.openid,
        recipient: or.order.recipient,
        phone: or.order.phone,
        address: or.order.address,
        modifiedAddress: or.order.modifiedAddress,
        productName: or.order.productName,
        price: Number(or.order.price),
        points: or.order.points,
        status: or.order.status,
        storeId: or.order.storeId || undefined,
        storeName: or.order.store?.name,
        shippedAt: or.order.shippedAt,
      }));

      // 找出未报价的商品
      for (const item of rfq.items) {
        // 排除已报价的商品
        if (quotedItemIds.has(item.id)) {
          continue;
        }
        
        // 排除已标记为电商采购的商品（source: 'ECOMMERCE' 或 trackingNo 存在）
        // 这些商品已经在电商平台采购，不需要再显示在未报价商品列表中
        if (item.source === 'ECOMMERCE' || item.trackingNo) {
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug(`商品已标记为电商采购，跳过`, { itemId: item.id, productName: item.productName });
          }
          continue;
        }
        
        // 排除供应商已发货的商品（有 SUPPLIER 的 Shipment 记录）
        // 这些商品已经有供应商发货，不需要再显示在未报价商品列表中
        const hasSupplierShipment = item.shipments && item.shipments.some((s) => s.source === 'SUPPLIER');
        if (hasSupplierShipment) {
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug(`商品供应商已发货，跳过`, { itemId: item.id, productName: item.productName });
          }
          continue;
        }
        
        // 优先通过订单号匹配订单，如果没有订单号则使用第一个订单
        let matchedOrder: typeof orderInfos[0] | undefined = undefined;
        
        if (item.orderNo) {
          // 通过订单号精确匹配
          matchedOrder = orderInfos.find(o => o.orderNo === item.orderNo);
        }
        
        // 如果没有找到匹配的订单，尝试通过商品名称匹配
        if (!matchedOrder) {
          matchedOrder = orderInfos.find(o => 
            o.productName && item.productName && 
            o.productName.trim() === item.productName.trim()
          );
        }
        
        // 如果还是没有找到，使用第一个订单
        if (!matchedOrder && orderInfos.length > 0) {
          matchedOrder = orderInfos[0];
        }
        
        // 门店信息：优先使用订单的门店信息，如果没有则使用询价单的门店信息
        const storeId = matchedOrder?.storeId || rfq.storeId || undefined;
        const storeName = matchedOrder?.storeName || rfq.store?.name || undefined;
        
        unquotedItems.push({
            rfqId: rfq.id,
            rfqNo: rfq.rfqNo,
            rfqTitle: rfq.title,
            itemId: item.id,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit,
            description: item.description || item.notes, // 备注
            deadline: rfq.deadline,
            // 物流信息
            trackingNo: item.trackingNo,
            carrier: item.carrier,
            // 成本价（电商平台采购）
            costPrice: item.costPrice ? Number(item.costPrice) : null,
            // 匹配的订单信息
            orderNo: matchedOrder?.orderNo,
            orderTime: matchedOrder?.orderTime,
            userNickname: matchedOrder?.userNickname,
            openid: matchedOrder?.openid,
            recipient: matchedOrder?.recipient,
            phone: matchedOrder?.phone,
            address: matchedOrder?.address,
            modifiedAddress: matchedOrder?.modifiedAddress,
            orderPrice: matchedOrder?.price,
            points: matchedOrder?.points,
            orderStatus: matchedOrder?.status,
            // 门店信息：优先使用订单的门店，如果没有则使用询价单的门店
            storeId: storeId,
            storeName: storeName,
            shippedAt: matchedOrder?.shippedAt,
            // 所有关联的订单信息
            orders: orderInfos.length > 0 ? orderInfos : undefined,
          });
      }
    }

      this.logger.log(`查找未报价商品完成: 找到 ${unquotedItems.length} 个未报价商品`, {
        totalCount: unquotedItems.length,
      });

      return unquotedItems;
    } catch (error) {
      this.logger.error('查找未报价商品失败', error);
      throw new BadRequestException('查找未报价商品失败，请稍后重试');
    }
  }

  /**
   * 更新询价单商品的物流单号
   */
  async updateRfqItemTracking(itemId: string, trackingNo?: string, carrier?: string, costPrice?: number, userId?: string) {
    // 门店用户只能更新自己门店的询价单商品物流信息
    if (userId) {
      const rfqItem = await this.prisma.rfqItem.findUnique({
        where: { id: itemId },
        include: {
          rfq: {
            select: { storeId: true },
          },
        },
      });

      if (rfqItem) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true, storeId: true },
        });

        if (user?.role === 'STORE' && user.storeId && rfqItem.rfq.storeId !== user.storeId) {
          throw new BadRequestException('门店用户只能更新自己门店的询价单商品物流信息');
        }
      }
    }
    // 如果提供了物流单号，说明是电商平台采购，需要设置 source 为 ECOMMERCE
    const updateData: Prisma.RfqItemUpdateInput = {
      trackingNo: trackingNo || null,
      carrier: carrier || null,
      costPrice: costPrice !== undefined ? costPrice : null,
    };

    // 如果提供了物流单号，设置为电商平台采购
    if (trackingNo) {
      updateData.source = 'ECOMMERCE';
    }

    const updated = await this.prisma.rfqItem.update({
      where: { id: itemId },
      data: updateData,
    });
    this.logger.debug('更新商品物流信息', {
      itemId,
      trackingNo,
      carrier,
      costPrice,
      source: trackingNo ? 'ECOMMERCE' : '未设置',
    });
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('更新后的 RfqItem', {
        id: updated.id,
        productName: updated.productName,
        trackingNo: updated.trackingNo,
        carrier: updated.carrier,
        costPrice: updated.costPrice,
        source: updated.source,
        shipmentId: updated.shipmentId,
      });
    }
    return updated;
  }

  /**
   * 获取所有询价单商品的发货状态总览（采购员用）
   */
  async getShipmentOverview(buyerId?: string, storeId?: string) {
    // 构建查询条件
    const whereCondition: Prisma.RfqWhereInput = {};
    if (storeId) {
      whereCondition.storeId = storeId;
    }

    // 获取所有询价单及其商品
    const rfqs = await this.prisma.rfq.findMany({
      where: whereCondition,
      include: {
        store: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        items: {
          include: {
            shipments: {
              include: {
                supplier: {
                  select: {
                    id: true,
                    username: true,
                  },
                },
              },
            },
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
            },
          },
        },
        awards: {
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
            quote: {
              include: {
                items: {
                  include: {
                    rfqItem: true,
                  },
                },
              },
            },
          },
        },
        orders: {
          include: {
            order: {
              select: {
                orderNo: true,
                recipient: true,
                phone: true,
                address: true,
                userNickname: true,
                openid: true,
                price: true,
                points: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // 构建总览数据
    const overview: Array<{
      rfqId: string;
      rfqNo: string;
      rfqTitle: string;
      itemId: string;
      productName: string;
      quantity: number;
      unit: string;
      orderNo?: string;
      recipient?: string;
      phone?: string;
      address?: string;
      userNickname?: string; // 用户名
      openid?: string; // OPENID
      orderPrice?: number; // 商品价值（机台标价）
      points?: number; // 积分
      supplierId?: string;
      supplierName?: string;
      trackingNo?: string;
      carrier?: string;
      costPrice?: number;
      shipmentStatus: 'SHIPPED' | 'NOT_SHIPPED' | 'ECOMMERCE';
      source?: 'SUPPLIER' | 'ECOMMERCE';
      awardedPrice?: number;
      shipmentCreatedAt?: Date;
      storeId?: string;
      storeName?: string;
      storeCode?: string;
      isReplacement?: boolean; // 是否为换货发货单
      shipmentNo?: string; // 发货单号
    }> = [];

    for (const rfq of rfqs) {
      for (const item of rfq.items) {
        // 查找该商品的中标信息
        // 注意：一个 RFQ 可以有多个 Award（每个供应商一个），需要找到真正中标该商品的供应商
        // 逻辑：如果商品已中标（itemStatus === 'AWARDED'），找到价格最低的报价，确定中标供应商
        let award = null;
        let winningQuoteItem = null;
        
        if (item.itemStatus === 'AWARDED' && item.quoteItems && item.quoteItems.length > 0) {
          // 找到价格最低的报价（中标供应商）
          winningQuoteItem = item.quoteItems.reduce((best, current) => {
            const bestPrice = parseFloat(best.price.toString());
            const currentPrice = parseFloat(current.price.toString());
            return currentPrice < bestPrice ? current : best;
          });
          
          // 根据中标供应商找到对应的 Award
          if (winningQuoteItem && winningQuoteItem.quote) {
            award = rfq.awards?.find(a => 
              a.supplierId === winningQuoteItem.quote.supplierId
            ) || null;
          }
        }

        // 查找该商品的发货信息（供应商发货）
        // 优先查找换货发货单（shipmentNo 以 REPLACE- 开头），如果没有则查找原始发货单
        const allSupplierShipments = item.shipments?.filter(s => s.source === 'SUPPLIER') || [];
        const replacementShipment = allSupplierShipments.find(s => s.shipmentNo?.startsWith('REPLACE-'));
        const supplierShipment = replacementShipment || allSupplierShipments[0];
        
        // 查找订单信息
        const orderInfo = rfq.orders.find(or => or.order.orderNo === item.orderNo)?.order;

        // 判断发货状态
        // 判断逻辑：
        // 1. 如果有 Shipment 记录且 source 为 'SUPPLIER'，说明供应商已发货 → "已发货"
        // 2. 如果 RfqItem 的 source 为 'ECOMMERCE' 或 trackingNo 存在（但没有 SUPPLIER 的 Shipment），说明是电商采购 → "电商采购"
        // 3. 如果没有供应商（未中标），自动归类为电商采购 → "电商采购"
        // 4. 如果已中标但没有 Shipment 记录，说明未发货 → "未发货"
        let shipmentStatus: 'SHIPPED' | 'NOT_SHIPPED' | 'ECOMMERCE' = 'NOT_SHIPPED';
        let supplierId: string | undefined;
        let supplierName: string | undefined;
        let trackingNo: string | undefined;
        let carrier: string | undefined;
        let awardedPrice: number | undefined;
        let shipmentCreatedAt: Date | undefined;

        // 优先检查供应商发货（Shipment 记录，source 为 'SUPPLIER'）
        // 供应商上传物流单号时会创建 Shipment 记录，source 为 'SUPPLIER'
        if (supplierShipment && supplierShipment.source === 'SUPPLIER') {
          // 供应商已发货
          shipmentStatus = 'SHIPPED';
          supplierId = supplierShipment.supplierId || undefined;
          supplierName = supplierShipment.supplier?.username || undefined;
          trackingNo = supplierShipment.trackingNo;
          carrier = supplierShipment.carrier || undefined;
          shipmentCreatedAt = supplierShipment.createdAt;
          // 判断是否为换货发货单
          const isReplacement = supplierShipment.shipmentNo?.startsWith('REPLACE-') || false;
          // 查找该商品的报价（使用中标报价）
          if (winningQuoteItem) {
            awardedPrice = Number(winningQuoteItem.price);
          } else if (award) {
            const quoteItem = award.quote.items.find(qi => qi.rfqItemId === item.id);
            if (quoteItem) {
              awardedPrice = Number(quoteItem.price);
            }
          }
          
          overview.push({
            rfqId: rfq.id,
            rfqNo: rfq.rfqNo,
            rfqTitle: rfq.title,
            itemId: item.id,
            productName: item.productName,
            quantity: item.quantity,
            unit: item.unit || '件',
            orderNo: orderInfo?.orderNo || item.orderNo || undefined,
            recipient: orderInfo?.recipient || undefined,
            phone: orderInfo?.phone || undefined,
            address: orderInfo?.address || undefined,
            userNickname: orderInfo?.userNickname || undefined,
            openid: orderInfo?.openid || undefined,
            orderPrice: orderInfo ? Number(orderInfo.price) : undefined,
            points: orderInfo?.points !== undefined && orderInfo?.points !== null ? orderInfo.points : undefined,
            supplierId,
            supplierName,
            trackingNo,
            carrier,
            costPrice: item.costPrice ? Number(item.costPrice) : undefined,
            shipmentStatus,
            source: item.source || undefined,
            awardedPrice,
            shipmentCreatedAt,
            storeId: rfq.storeId || undefined,
            storeName: rfq.store?.name || undefined,
            storeCode: rfq.store?.code || undefined,
            isReplacement,
            shipmentNo: supplierShipment.shipmentNo,
          });
          continue; // 跳过后续逻辑，已处理完成
        } 
        // 检查电商平台采购（RfqItem 的 source 为 'ECOMMERCE' 或 trackingNo 存在，但没有 SUPPLIER 的 Shipment）
        // 采购员在电商采购清单中更新物流单号时，会设置 RfqItem 的 source 为 'ECOMMERCE'
        else if (item.source === 'ECOMMERCE' || (item.trackingNo && !supplierShipment)) {
          // 电商平台采购
          shipmentStatus = 'ECOMMERCE';
          trackingNo = item.trackingNo || undefined;
          carrier = item.carrier || undefined;
          // 对于电商平台采购，发货时间就是采购员输入快递单号的时间（updatedAt）
          // 只有当 trackingNo 存在时，才认为已输入快递单号，使用 updatedAt 作为发货时间
          if (item.trackingNo) {
            shipmentCreatedAt = item.updatedAt;
          }
        } 
        // 检查是否没有供应商（未中标）
        // 如果没有中标（没有 winningQuoteItem 和 award），自动归类为电商采购
        else if (!winningQuoteItem && !award) {
          // 没有供应商，自动归类为电商采购
          shipmentStatus = 'ECOMMERCE';
          trackingNo = item.trackingNo || undefined;
          carrier = item.carrier || undefined;
          // 对于电商平台采购，发货时间就是采购员输入快递单号的时间（updatedAt）
          // 只有当 trackingNo 存在时，才认为已输入快递单号，使用 updatedAt 作为发货时间
          if (item.trackingNo) {
            shipmentCreatedAt = item.updatedAt;
          }
        }
        // 检查已中标但未发货
        else if (winningQuoteItem || award) {
          // 已中标但未发货
          shipmentStatus = 'NOT_SHIPPED';
          // 优先使用中标报价的供应商信息
          if (winningQuoteItem && winningQuoteItem.quote) {
            supplierId = winningQuoteItem.quote.supplierId;
            supplierName = winningQuoteItem.quote.supplier.username;
            awardedPrice = Number(winningQuoteItem.price);
          } else if (award) {
            supplierId = award.supplierId;
            supplierName = award.supplier.username;
            // 查找该商品的报价
            const quoteItem = award.quote.items.find(qi => qi.rfqItemId === item.id);
            if (quoteItem) {
              awardedPrice = Number(quoteItem.price);
            }
          }
        }

        overview.push({
          rfqId: rfq.id,
          rfqNo: rfq.rfqNo,
          rfqTitle: rfq.title,
          itemId: item.id,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit || '件',
          orderNo: orderInfo?.orderNo || item.orderNo || undefined,
          recipient: orderInfo?.recipient || undefined,
          phone: orderInfo?.phone || undefined,
          address: orderInfo?.address || undefined,
          userNickname: orderInfo?.userNickname || undefined,
          openid: orderInfo?.openid || undefined,
          orderPrice: orderInfo?.price ? Number(orderInfo.price) : undefined,
          points: orderInfo?.points || undefined,
          supplierId,
          supplierName,
          trackingNo,
          carrier,
          costPrice: item.costPrice ? Number(item.costPrice) : undefined,
          shipmentStatus,
          source: item.source || undefined,
          awardedPrice,
          shipmentCreatedAt,
          storeId: rfq.storeId || undefined,
          storeName: rfq.store?.name || undefined,
          storeCode: rfq.store?.code || undefined,
          isReplacement: false,
          shipmentNo: undefined,
        });
      }
    }

    // 添加从库存下单的订单数据（source: 'ECOMMERCE'）
    // 查询所有从库存下单的订单及其发货单
    const inventoryOrders = await this.prisma.order.findMany({
      where: {
        source: 'ECOMMERCE', // 从库存下单的订单
        storeId: storeId || undefined, // 如果指定了门店，只查询该门店的订单
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
            source: 'ECOMMERCE', // 从库存下单的发货单
          },
          include: {
            supplier: {
              select: {
                id: true,
                username: true,
              },
            },
            packages: {
              select: {
                id: true,
                photos: true,
                labelUrl: true,
              },
            },
          },
        },
      },
      orderBy: {
        orderTime: 'desc',
      },
    });

    // 将库存订单转换为总览数据格式
    for (const order of inventoryOrders) {
      // 查找该订单的发货单
      const shipment = order.shipments?.[0]; // 从库存下单通常只有一个发货单
      
      // 判断发货状态
      let shipmentStatus: 'SHIPPED' | 'NOT_SHIPPED' | 'ECOMMERCE' = 'NOT_SHIPPED';
      let trackingNo: string | undefined;
      let carrier: string | undefined;
      let supplierId: string | undefined;
      let supplierName: string | undefined;
      let shipmentCreatedAt: Date | undefined;
      
      if (shipment) {
        if (shipment.trackingNo) {
          // 已填写快递单号，视为已发货
          shipmentStatus = 'SHIPPED';
          trackingNo = shipment.trackingNo;
          carrier = shipment.carrier || undefined;
          supplierId = shipment.supplierId || undefined;
          supplierName = shipment.supplier?.username || undefined;
          shipmentCreatedAt = shipment.shippedAt || shipment.createdAt;
        } else {
          // 有发货单但未填写快递单号，视为未发货
          shipmentStatus = 'NOT_SHIPPED';
          supplierId = shipment.supplierId || undefined;
          supplierName = shipment.supplier?.username || undefined;
        }
      } else {
        // 没有发货单，视为未发货
        shipmentStatus = 'NOT_SHIPPED';
      }

      // 生成一个虚拟的 rfqId 和 itemId（用于区分库存订单）
      const virtualRfqId = `inventory-order-${order.id}`;
      const virtualItemId = `inventory-item-${order.id}`;

      overview.push({
        rfqId: virtualRfqId,
        rfqNo: `INV-${order.orderNo}`, // 使用订单号作为虚拟询价单号
        rfqTitle: `库存订单：${order.productName}`,
        itemId: virtualItemId,
        productName: order.productName,
        quantity: 1, // 库存订单通常数量为1
        unit: '件',
        orderNo: order.orderNo,
        recipient: order.recipient || undefined,
        phone: order.phone || undefined,
        address: order.address || undefined,
        userNickname: order.userNickname || undefined,
        openid: order.openid || undefined,
        orderPrice: Number(order.price) || undefined,
        points: order.points || undefined,
        supplierId,
        supplierName,
        trackingNo,
        carrier,
        costPrice: undefined, // 库存订单没有成本价
        shipmentStatus,
        source: 'ECOMMERCE', // 标记为库存订单
        awardedPrice: undefined, // 库存订单没有中标价
        shipmentCreatedAt,
        storeId: order.storeId || undefined,
        storeName: order.store?.name || undefined,
        storeCode: order.store?.code || undefined,
        isReplacement: false,
        shipmentNo: shipment?.shipmentNo || undefined,
      });
    }

    return overview;
  }

  /**
   * 更新电商采购状态
   */
  async updateMaxPrice(itemId: string, maxPrice: number, userId: string, instantPrice?: number | null) {
    if (maxPrice <= 0) {
      throw new BadRequestException('最高限价必须大于0');
    }

    // 如果提供了一口价，验证一口价必须大于0且小于等于最高限价
    if (instantPrice !== undefined && instantPrice !== null) {
      if (instantPrice <= 0) {
        throw new BadRequestException('一口价必须大于0');
      }
      if (instantPrice > maxPrice) {
        throw new BadRequestException('一口价不能大于最高限价');
      }
    }

    const rfqItem = await this.prisma.rfqItem.findUnique({
      where: { id: itemId },
      include: {
        rfq: true,
      },
    });

    if (!rfqItem) {
      throw new BadRequestException('RFQ item not found');
    }

    // 验证用户权限（采购员、管理员和门店用户可以设置最高限价）
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || (user.role !== 'BUYER' && user.role !== 'ADMIN' && user.role !== 'STORE')) {
      throw new BadRequestException('只有采购员、管理员和门店用户可以设置最高限价');
    }

    // 门店用户只能设置自己门店的询价单的最高限价
    if (user.role === 'STORE' && user.storeId && rfqItem.rfq.storeId !== user.storeId) {
      throw new BadRequestException('门店用户只能设置自己门店的询价单的最高限价');
    }

    // 验证询价单状态（只有在草稿或已发布状态才能设置）
    if (rfqItem.rfq.status !== 'DRAFT' && rfqItem.rfq.status !== 'PUBLISHED') {
      throw new BadRequestException('只有在草稿或已发布状态的询价单才能设置最高限价');
    }

    const updateData: any = {
      maxPrice: maxPrice,
    };

    // 如果提供了一口价，更新一口价；如果为 null，则清除一口价
    if (instantPrice !== undefined) {
      updateData.instantPrice = instantPrice;
    }

    const updated = await this.prisma.rfqItem.update({
      where: { id: itemId },
      data: updateData,
    });

    // 记录审计日志
    await this.auditService.log({
      userId,
      action: 'UPDATE_RFQ_ITEM_MAX_PRICE',
      resource: 'RfqItem',
      resourceId: itemId,
      details: {
        productName: rfqItem.productName,
        oldMaxPrice: rfqItem.maxPrice ? Number(rfqItem.maxPrice) : null,
        newMaxPrice: maxPrice,
        oldInstantPrice: rfqItem.instantPrice ? Number(rfqItem.instantPrice) : null,
        newInstantPrice: instantPrice !== undefined ? (instantPrice ? Number(instantPrice) : null) : undefined,
      },
    });

    return updated;
  }

  /**
   * 按商品级别选商（手动选择某个供应商的某个商品报价）
   */
  async awardItem(
    rfqId: string,
    rfqItemId: string,
    quoteItemId: string,
    quoteId: string,
    reason: string = '手动选商（按商品级别）',
    userId: string,
  ) {
    this.logger.debug('开始按商品级别选商', { rfqId, rfqItemId, quoteItemId, quoteId });

    // 验证询价单是否存在且已截标
    const rfq = await this.prisma.rfq.findUnique({
      where: { id: rfqId },
      include: {
        items: true,
      },
    });

    if (!rfq) {
      throw new BadRequestException('询价单不存在');
    }

    if (rfq.status !== 'CLOSED' && rfq.status !== 'AWARDED') {
      throw new BadRequestException('询价单未截标，无法选商');
    }

    // 验证商品是否属于此询价单
    const rfqItem = rfq.items.find(item => item.id === rfqItemId);
    if (!rfqItem) {
      throw new BadRequestException('商品不属于此询价单');
    }

    // 验证报价项是否存在且属于此报价
    const quoteItem = await this.prisma.quoteItem.findUnique({
      where: { id: quoteItemId },
      include: {
        quote: true,
        rfqItem: true,
      },
    });

    if (!quoteItem) {
      throw new BadRequestException('报价项不存在');
    }

    if (quoteItem.quoteId !== quoteId) {
      throw new BadRequestException('报价项不属于此报价');
    }

    if (quoteItem.rfqItemId !== rfqItemId) {
      throw new BadRequestException('报价项不属于此商品');
    }

    if (quoteItem.quote.rfqId !== rfqId) {
      throw new BadRequestException('报价不属于此询价单');
    }

    // 更新商品状态为已中标
    await this.prisma.rfqItem.update({
      where: { id: rfqItemId },
      data: {
        itemStatus: 'AWARDED',
      },
    });

    this.logger.debug('商品状态已更新为 AWARDED', { rfqItemId });

    // 检查此报价的所有商品，看哪些商品中标了
    const quoteAllItems = await this.prisma.quoteItem.findMany({
      where: {
        quoteId,
      },
      include: {
        rfqItem: true,
      },
    });

    // 统计此报价中标的商品数量（只统计状态为 AWARDED 的商品）
    // 注意：这里只统计状态，不验证是否真的由该供应商中标
    // 真正的验证在 findBySupplier 中进行，通过比较价格来确定
    const quoteAwardedItemsCount = quoteAllItems.filter(item => 
      item.rfqItem.itemStatus === 'AWARDED'
    ).length;

    if (quoteAwardedItemsCount > 0) {
      // 该报价有商品中标，标记为 AWARDED
      // 注意：这并不意味着该报价的所有商品都中标了，只是有部分商品中标
      // 在 findBySupplier 中会验证每个商品是否真的由该供应商中标
      await this.prisma.quote.update({
        where: { id: quoteId },
        data: { status: 'AWARDED' },
      });
      this.logger.debug('报价状态已更新为 AWARDED', {
        quoteId,
        awardedCount: quoteAwardedItemsCount,
        totalCount: quoteAllItems.length,
      });
    }

    // 检查询价单是否所有商品都已中标，如果是，更新询价单状态
    const allRfqItems = await this.prisma.rfqItem.findMany({
      where: { rfqId },
    });

    const allAwarded = allRfqItems.every(item => item.itemStatus === 'AWARDED' || item.itemStatus === 'CANCELLED' || item.itemStatus === 'OUT_OF_STOCK');
    
    const isRfqStatusChanged = allAwarded && rfq.status !== 'AWARDED';
    
    if (isRfqStatusChanged) {
      await this.prisma.rfq.update({
        where: { id: rfqId },
        data: { status: 'AWARDED' },
      });
      this.logger.log('询价单所有商品已中标，状态已更新为 AWARDED', { rfqId });
    }

    // 创建或更新 Award 记录（用于兼容性）
    // 注意：现在一个 RFQ 可以有多个 Award（每个供应商一个），所以需要通过 rfqId 和 supplierId 查找
    const supplierId = quoteItem.quote.supplierId;
    const existingAward = await this.prisma.award.findUnique({
      where: {
        rfqId_supplierId: {
          rfqId,
          supplierId,
        },
      },
    });

    if (!existingAward) {
      // 创建汇总的 Award 记录
      const totalPrice = parseFloat(quoteItem.price.toString()) * (rfqItem.quantity || 1);
      
      await this.prisma.award.create({
        data: {
          rfqId,
          quoteId,
          supplierId,
          finalPrice: totalPrice,
          reason: `手动选商（按商品级别）：${rfqItem.productName}`,
        },
      });
      this.logger.debug('创建了汇总 Award 记录', { rfqId, supplierId });
    } else {
      // 更新现有 Award 记录的总价
      // 注意：应该使用该供应商的实际中标报价，而不是最低价
      const awardedItems = await this.prisma.rfqItem.findMany({
        where: {
          rfqId,
          itemStatus: 'AWARDED',
        },
        include: {
          quoteItems: {
            where: {
              quote: {
                supplierId: supplierId, // 只查询该供应商的报价项
              },
            },
            include: {
              quote: true,
            },
          },
        },
      });

      let totalPrice = 0;
      for (const item of awardedItems) {
        if (item.id === rfqItemId) {
          // 对于当前正在中标的商品，使用用户选择的报价项
          totalPrice += parseFloat(quoteItem.price.toString()) * (item.quantity || 1);
        } else if (item.quoteItems && item.quoteItems.length > 0) {
          // 对于其他已中标的商品，使用该供应商的报价项（如果该供应商有报价）
          // 注意：这里应该使用该供应商的实际报价，而不是最低价
          // 如果该供应商有多个报价项，选择价格最低的那个（因为可能是之前手动选择的）
          const supplierQuoteItems = item.quoteItems.filter(qi => qi.quote.supplierId === supplierId);
          if (supplierQuoteItems.length > 0) {
            // 如果该供应商有报价，使用该供应商的报价项
            const bestQuoteItem = supplierQuoteItems.reduce((best, current) => {
            const bestPrice = parseFloat(best.price.toString());
            const currentPrice = parseFloat(current.price.toString());
            return currentPrice < bestPrice ? current : best;
          });
          totalPrice += parseFloat(bestQuoteItem.price.toString()) * (item.quantity || 1);
          }
          // 如果该供应商没有报价，说明该商品是由其他供应商中标的，不计入总价
        }
      }

      await this.prisma.award.update({
        where: { id: existingAward.id },
        data: {
          finalPrice: totalPrice,
          reason: `手动选商（按商品级别），共 ${awardedItems.filter(item => {
            // 只统计该供应商中标的商品
            if (item.id === rfqItemId) return true;
            return item.quoteItems && item.quoteItems.length > 0;
          }).length} 个商品`,
        },
      });
      this.logger.debug('更新了 Award 记录', {
        awardId: existingAward.id,
        totalPrice: totalPrice.toFixed(2),
        currentItemPrice: parseFloat(quoteItem.price.toString()).toFixed(2),
      });
    }

    // 获取供应商信息
    const supplier = await this.prisma.user.findUnique({
      where: { id: quoteItem.quote.supplierId },
      select: { username: true },
    });

    // 通知供应商（不发送钉钉，避免重复）
    await this.notificationService.create({
      userId: quoteItem.quote.supplierId,
      type: 'QUOTE_AWARDED',
      title: '报价中标',
      content: `恭喜！您在询价单 ${rfq.rfqNo} 中的商品 "${rfqItem.productName}" 已中标，价格 ¥${parseFloat(quoteItem.price.toString()).toFixed(2)}/件`,
      link: `/quotes`,
      userName: supplier?.username || undefined,
      sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
    });

    // 通知所有管理员（创建系统内通知，但不发送钉钉）
    const admins = await this.prisma.user.findMany({
      where: { role: 'ADMIN' },
      select: { id: true, username: true },
    });

    for (const admin of admins) {
      await this.notificationService.create({
        userId: admin.id,
        type: 'QUOTE_AWARDED',
        title: '报价中标通知',
        content: `供应商 ${supplier?.username || '未知'} 在询价单 ${rfq.rfqNo} 中的商品 "${rfqItem.productName}" 已中标，价格 ¥${parseFloat(quoteItem.price.toString()).toFixed(2)}/件`,
        link: `/rfqs/${rfqId}`,
        userName: admin.username || undefined,
        sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
      });
    }

    // 只在询价单状态变为 AWARDED（所有商品都中标）时发送一条汇总的钉钉消息
    if (isRfqStatusChanged && this.dingTalkService) {
      // 获取询价单的完整信息（包括所有商品和供应商）
      const rfqForDingTalk = await this.prisma.rfq.findUnique({
        where: { id: rfqId },
        include: {
          items: {
            where: {
              itemStatus: 'AWARDED',
            },
            include: {
              quoteItems: {
                include: {
                  quote: {
                    include: {
                      supplier: {
                        select: {
                          username: true,
                        },
                      },
                    },
                  },
                },
                orderBy: {
                  price: 'asc', // 按价格排序，取最低价
                },
                take: 1, // 只取第一个（最低价）
              },
            },
          },
        },
      });

      if (rfqForDingTalk && rfqForDingTalk.items.length > 0) {
        // 统计中标信息，按供应商分组
        const supplierMap = new Map<string, Array<{ name: string; price: number; quantity: number }>>();

        rfqForDingTalk.items.forEach((item) => {
          if (item.quoteItems && item.quoteItems.length > 0) {
            const bestQuoteItem = item.quoteItems[0];
            const supplierName = bestQuoteItem.quote.supplier.username || '未知供应商';
            const price = parseFloat(bestQuoteItem.price.toString());
            const quantity = item.quantity || 1;

            if (!supplierMap.has(supplierName)) {
              supplierMap.set(supplierName, []);
            }
            supplierMap.get(supplierName)!.push({
              name: item.productName,
              price,
              quantity,
            });
          }
        });

        // 构建汇总消息
        let dingTalkContent = `询价单 ${rfqForDingTalk.rfqNo} 已截标中标，共 ${rfqForDingTalk.items.length} 个商品：\n\n`;
        
        supplierMap.forEach((items, supplierName) => {
          dingTalkContent += `**${supplierName}**：\n`;
          items.forEach((item) => {
            dingTalkContent += `  - ${item.name}：¥${item.price.toFixed(2)}/件 × ${item.quantity}件 = ¥${(item.price * item.quantity).toFixed(2)}\n`;
          });
          const supplierTotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
          dingTalkContent += `  小计：¥${supplierTotal.toFixed(2)}\n\n`;
        });

        const totalAmount = Array.from(supplierMap.values())
          .flat()
          .reduce((sum, item) => sum + item.price * item.quantity, 0);
        dingTalkContent += `**总金额：¥${totalAmount.toFixed(2)}**`;

        this.logger.debug(`[RFQService] 发送截标中标汇总钉钉通知: 询价单 ${rfqForDingTalk.rfqNo}`);
      this.dingTalkService
        .sendNotification({
          type: 'QUOTE_AWARDED',
            title: '询价单截标中标通知',
          content: dingTalkContent,
          link: `/rfqs/${rfqId}`,
          userName: '系统',
        })
        .catch((error) => {
          this.logger.error('[RFQService] 钉钉通知发送失败:', error);
        });
      }
    }

    this.logger.debug(`已通知供应商和 ${admins.length} 个管理员关于商品 ${rfqItem.productName} 的中标`);

    // 记录审计日志
    await this.auditService.log({
      action: 'rfq.award',
      resource: 'RfqItem',
      resourceId: rfqItemId,
      userId,
      details: {
        rfqNo: rfq.rfqNo,
        rfqId,
        rfqItemId,
        productName: rfqItem.productName,
        quoteId,
        quoteItemId,
        supplierId: quoteItem.quote.supplierId,
        price: parseFloat(quoteItem.price.toString()),
        reason,
      },
    });

    this.logger.log('按商品级别选商完成', {
      productName: rfqItem.productName,
      supplierId: quoteItem.quote.supplierId,
    });

    return {
      success: true,
      message: '选商成功',
      rfqItem: {
        id: rfqItemId,
        productName: rfqItem.productName,
        itemStatus: 'AWARDED',
      },
      quote: {
        id: quoteId,
        supplierId: quoteItem.quote.supplierId,
      },
    };
  }

  async updateEcommerceStatus(rfqItemId: string, status: 'ECOMMERCE_PENDING' | 'ECOMMERCE_PAID' | 'ECOMMERCE_SHIPPED', userId: string) {
    const rfqItem = await this.prisma.rfqItem.findUnique({
      where: { id: rfqItemId },
      include: {
        rfq: true,
      },
    });

    if (!rfqItem) {
      throw new BadRequestException('RFQ item not found');
    }

    // 门店用户只能更新自己门店的询价单商品状态
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, storeId: true },
    });

    if (user?.role === 'STORE' && user.storeId && rfqItem.rfq.storeId !== user.storeId) {
      throw new BadRequestException('门店用户只能更新自己门店的询价单商品状态');
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
   * 删除询价单（仅限草稿状态）
   */
  async delete(id: string, userId: string) {
    const rfq = await this.prisma.rfq.findUnique({
      where: { id },
      include: {
        items: true,
        quotes: true,
        awards: true,
      },
    });

    if (!rfq) {
      throw new BadRequestException('询价单不存在');
    }

    // 验证用户权限：管理员、采购员和门店用户可以删除询价单
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, storeId: true },
    });

    if (!user || (user.role !== 'ADMIN' && user.role !== 'BUYER' && user.role !== 'STORE')) {
      throw new BadRequestException('无权删除此询价单');
    }

    // 门店用户只能删除自己门店的询价单
    if (user.role === 'STORE' && user.storeId && rfq.storeId !== user.storeId) {
      throw new BadRequestException('门店用户只能删除自己门店的询价单');
    }

    // 只能删除草稿状态的询价单
    if (rfq.status !== 'DRAFT') {
      throw new BadRequestException('只能删除草稿状态的询价单');
    }

    // 检查是否有报价
    if (rfq.quotes && rfq.quotes.length > 0) {
      throw new BadRequestException('该询价单已有报价，无法删除');
    }

    // 检查是否有中标记录
    if (rfq.awards && rfq.awards.length > 0) {
      throw new BadRequestException('该询价单已有中标记录，无法删除');
    }

    // 使用事务删除相关数据
    await this.prisma.$transaction(async (tx) => {
      // 删除询价单商品
      if (rfq.items && rfq.items.length > 0) {
        await tx.rfqItem.deleteMany({
          where: { rfqId: id },
        });
      }

      // 删除询价单与订单的关联
      await tx.orderRfq.deleteMany({
        where: { rfqId: id },
      });

      // 删除询价单
      await tx.rfq.delete({
        where: { id },
      });
    });

    // 记录审计日志
    await this.auditService.log({
      action: 'rfq.delete',
      resource: 'RFQ',
      resourceId: id,
      userId,
      details: {
        rfqNo: rfq.rfqNo,
        title: rfq.title,
      },
    });

    this.logger.log(`询价单 ${rfq.rfqNo} 已删除`);

    return { success: true, message: '询价单已删除' };
  }
}

