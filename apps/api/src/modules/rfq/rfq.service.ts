import { Injectable, Inject, forwardRef, BadRequestException, NotFoundException, Logger, Optional } from '@nestjs/common';
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
  async getStats(user: any): Promise<{ totalRfqs: number; pendingQuotes: number }> {
    const where: Prisma.RfqWhereInput = {};
    
    // 根据用户角色过滤
    if (user.role === 'STORE' && user.storeId) {
      where.storeId = user.storeId;
    }
    
    const [totalRfqs, pendingQuotes] = await Promise.all([
      this.prisma.rfq.count({ where }),
      this.prisma.rfq.count({
        where: {
          ...where,
          status: 'PUBLISHED',
          deadline: { gt: new Date() },
        },
      }),
    ]);
    
    return { totalRfqs, pendingQuotes };
  }

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
          
          rows = XLSX.utils.sheet_to_json(worksheet, {
            defval: '', // 空单元格使用空字符串而不是 undefined
            raw: false, // 不返回原始值，统一转换为字符串
          });
          this.logger.debug('Excel 解析结果', { rowsCount: rows.length });
          if (rows.length > 0) {
            // 记录表头信息（用于调试，无论开发还是生产环境）
            const headers = Object.keys(rows[0]);
            this.logger.log('Excel 文件表头', { 
              headers,
              headersCount: headers.length,
              firstRowSample: Object.fromEntries(
                headers.slice(0, 5).map(key => [key, String(rows[0][key] || '').substring(0, 30)])
              )
            });
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
    
    // 记录第一行的所有表头，用于调试
    if (rows.length > 0) {
      const firstRowKeys = Object.keys(rows[0]);
      this.logger.debug('文件表头列表', { 
        headers: firstRowKeys,
        headersCount: firstRowKeys.length,
        firstRowSample: Object.fromEntries(
          firstRowKeys.slice(0, 5).map(key => [key, rows[0][key]])
        )
      });
    }
    
    for (const row of rows) {
      const getField = (possibleNames: string[]): string | undefined => {
        // 获取所有表头键，并规范化（去除首尾空格）
        const normalizedRowKeys = Object.keys(row).map(key => ({
          original: key,
          normalized: key.trim().replace(/\s+/g, ' '), // 规范化：去除首尾空格，多个空格合并为一个
        }));
        
        for (const name of possibleNames) {
          const normalizedName = name.trim().replace(/\s+/g, ' '); // 规范化搜索名称
          
          // 1. 精确匹配（考虑空格）
          for (const { original, normalized } of normalizedRowKeys) {
            if (normalized === normalizedName || original === name) {
              const value = row[original];
              if (value !== undefined && value !== null && value !== '') {
                this.logger.debug(`字段匹配成功（精确）`, { 
                  searchName: name, 
                  foundKey: original,
                  value: String(value).substring(0, 50) // 只记录前50个字符
                });
                return String(value);
              }
            }
          }
          
          // 2. 尝试大小写不敏感匹配（考虑空格）
          const lowerName = normalizedName.toLowerCase();
          for (const { original, normalized } of normalizedRowKeys) {
            const lowerNormalized = normalized.toLowerCase();
            if (lowerNormalized === lowerName) {
              const foundValue = row[original];
              if (foundValue !== undefined && foundValue !== null && foundValue !== '') {
                this.logger.debug(`字段匹配成功（大小写不敏感）`, { 
                  searchName: name, 
                  foundKey: original,
                  value: String(foundValue).substring(0, 50)
                });
                return String(foundValue);
              }
            }
          }
          
          // 3. 尝试匹配带括号的表头（如 "手机号(可选)" 匹配 "手机号"）
          // 移除括号及其内容，然后匹配
          const nameWithoutBrackets = normalizedName.replace(/\([^)]*\)/g, '').trim();
          if (nameWithoutBrackets && nameWithoutBrackets !== normalizedName) {
            const lowerNameWithoutBrackets = nameWithoutBrackets.toLowerCase();
            for (const { original, normalized } of normalizedRowKeys) {
              // 移除表头中的括号内容后匹配
              const keyWithoutBrackets = normalized.replace(/\([^)]*\)/g, '').trim();
              if (keyWithoutBrackets.toLowerCase() === lowerNameWithoutBrackets) {
                const foundValue = row[original];
                if (foundValue !== undefined && foundValue !== null && foundValue !== '') {
                  this.logger.debug(`字段匹配成功（括号匹配）`, { 
                    searchName: name, 
                    foundKey: original,
                    value: String(foundValue).substring(0, 50)
                  });
                  return String(foundValue);
                }
              }
            }
          }
          
          // 4. 尝试部分匹配（如果表头包含搜索名称，或搜索名称包含表头）
          for (const { original, normalized } of normalizedRowKeys) {
            const lowerNormalized = normalized.toLowerCase();
            const lowerSearch = lowerName;
            // 如果表头包含搜索名称，或搜索名称包含表头（至少3个字符）
            if ((lowerNormalized.includes(lowerSearch) || lowerSearch.includes(lowerNormalized)) 
                && Math.min(lowerNormalized.length, lowerSearch.length) >= 3) {
              const foundValue = row[original];
              if (foundValue !== undefined && foundValue !== null && foundValue !== '') {
                this.logger.debug(`字段匹配成功（部分匹配）`, { 
                  searchName: name, 
                  foundKey: original,
                  value: String(foundValue).substring(0, 50)
                });
                return String(foundValue);
              }
            }
          }
        }
        
        // 如果所有匹配都失败，记录调试信息
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug(`字段匹配失败`, { 
            searchNames: possibleNames,
            availableKeys: normalizedRowKeys.map(k => k.original)
          });
        }
        return undefined;
      };

      // 提取订单信息
      const orderNo = getField([
        '订单号', 'orderNo', '订单编号', '订单ID', 'orderId', '订单', '编号', 
        '订单号', '订单编号', '订单单号', '单号', 'order_no', 'ORDER_NO',
        '订单号(可选)' // 支持模板中的带括号字段名
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
        '用户名称', '用户昵称', 'nick_name', 'USER_NICKNAME',
        '用户昵称(可选)' // 支持模板中的带括号字段名
      ]);
      
      const openid = getField([
        'openid', 'OpenID', 'openId', '用户ID', 'userId', '用户标识', 
        '用户openid', 'open_id', 'OPEN_ID', '用户openid',
        'openid(可选)', 'OpenID(可选)', 'openId(可选)', // 支持模板中的带括号字段名
        'open_id', 'OPEN_ID' // 支持下划线格式
      ]) || `openid-${Date.now()}`;
      
      const recipient = getField([
        '收货人', 'recipient', '姓名', '收件人', '收货人姓名', 'name', 
        '联系人', '联系人姓名', '收货人', '收件人', '姓名',
        '收件人(可选)', '收货人(可选)' // 支持模板中的带括号字段名
      ]);
      
      const phone = getField([
        '电话', 'phone', '手机', '联系电话', '手机号', 'mobile', 
        '联系方式', '联系电话', '手机号码', 'phone_number', 'PHONE',
        '手机号(可选)', '手机(可选)', '电话(可选)' // 支持模板中的带括号字段名
      ]);
      
      const address = getField([
        '地址', 'address', '收货地址', '详细地址', 'deliveryAddress', 
        '配送地址', '地址详情', '收货地址', '详细地址', 'address',
        '地址(可选)', '收货地址(可选)' // 支持模板中的带括号字段名
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
        '商品描述', '产品描述', '备注', 'notes',
        '描述(可选)', '备注(可选)' // 支持模板中的带括号字段名
      ]);
      
      const priceRaw = getField([
        '价值', '价格', 'price', '金额', '单价', '总价', 'totalPrice', '商品价格', '价值(可选)', '价格(可选)', 
        '订单金额', '实付金额', '支付金额', 'price', 'PRICE', '金额'
      ]);
      const price = priceRaw ? parseFloat(String(priceRaw).replace(/[^\d.-]/g, '')) || 0 : 0;
      
      const pointsRaw = getField([
        '积分', 'points', '积分值', 'point', 'points', 'POINTS',
        '积分(可选)' // 支持模板中的带括号字段名
      ]);
      const points = pointsRaw ? parseInt(String(pointsRaw)) || 0 : 0;

      // 提取订单状态（虽然当前不直接使用，但保留以便后续扩展）
      const orderStatusRaw = getField([
        '状态', 'status', '订单状态', 'orderStatus', '订单状态', 'STATUS',
        '状态(可选)', '订单状态(可选)' // 支持模板中的带括号字段名
      ]);
      const orderStatus = orderStatusRaw ? String(orderStatusRaw).trim() : undefined;

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

  async findAll(filters?: RfqFindAllFilters, userRole?: string): Promise<any[]> {
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
    
    // ⚠️ 供应商端不返回门店信息，保护门店隐私
    const isSupplier = userRole === 'SUPPLIER';
    
    // 优化：列表页只查询必要字段，大幅减少数据传输量和查询时间
    // 不查询 orders、quotes、awards 的详细信息（详情页才需要）
    const result = await this.prisma.rfq.findMany({
      where,
      include: {
        // 只查询 store 的 name（用于处理 title），不查询其他字段
        store: isSupplier ? {
          select: {
            name: true, // 只需要 name 用于处理 title
          },
        } : {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        buyer: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
        // 只查询商品基本信息，不查询详细信息
        items: {
          select: {
            id: true,
            productName: true,
            quantity: true,
            unit: true,
            maxPrice: true,
            instantPrice: true,
            itemStatus: true,
          },
        },
        // 不查询 orders、quotes、awards 的详细信息（列表页不需要）
        // 只查询报价数量（使用 _count）
      },
      orderBy: {
        createdAt: 'desc',
      },
      // 添加分页：默认只返回前 100 条，避免数据量过大
      take: filters?.limit ? Number(filters.limit) : 100,
      skip: filters?.offset ? Number(filters.offset) : 0,
    });
    
    // 为每个询价单添加报价和中标数量（使用单独的查询，避免 N+1）
    const rfqIds = result.map(rfq => rfq.id);
    const [quoteCounts, awardCounts] = await Promise.all([
      this.prisma.quote.groupBy({
        by: ['rfqId'],
        where: { rfqId: { in: rfqIds } },
        _count: true,
      }),
      this.prisma.award.groupBy({
        by: ['rfqId'],
        where: { 
          rfqId: { in: rfqIds },
          status: { not: 'CANCELLED' },
        },
        _count: true,
      }),
    ]);
    
    const quoteCountMap = new Map(quoteCounts.map(q => [q.rfqId, q._count]));
    const awardCountMap = new Map(awardCounts.map(a => [a.rfqId, a._count]));
    
    // 为每个询价单添加报价和中标数量
    const resultWithCounts = result.map(rfq => ({
      ...rfq,
      quoteCount: quoteCountMap.get(rfq.id) || 0,
      awardCount: awardCountMap.get(rfq.id) || 0,
    }));
    
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('查询结果', { count: resultWithCounts.length });
    }
    
    // 如果是供应商查询已发布的询价单，需要过滤掉那些有商品未设置最高限价的询价单
    if (filters?.status === 'PUBLISHED') {
      const filteredResult = resultWithCounts.filter((rfq) => {
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
      
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug(`findAll: 过滤后结果 ${filteredResult.length} 个询价单（所有商品都设置了最高限价）`);
      }
      
      // ⚠️ 供应商端不返回门店信息，保护门店隐私（双重保护）
      if (isSupplier) {
        return filteredResult.map(rfq => {
          // 从 title 中移除店铺名称
          let sanitizedTitle = rfq.title;
          if (rfq.store?.name && sanitizedTitle) {
            // 移除店铺名称（格式：店铺名称 日期 序号 或 店铺名称 日期）
            // 转义特殊字符，确保正则表达式安全
            const escapedStoreName = rfq.store.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const storeNamePattern = new RegExp(`^${escapedStoreName}\\s+`, 'i');
            sanitizedTitle = sanitizedTitle.replace(storeNamePattern, '');
          }
          return {
            ...rfq,
            title: sanitizedTitle,
            store: undefined, // 移除门店信息
          };
        });
      }
      
      return filteredResult;
    }
    
    // ⚠️ 供应商端不返回门店信息，保护门店隐私（双重保护）
    if (isSupplier) {
      return resultWithCounts.map(rfq => {
        // 从 title 中移除店铺名称
        let sanitizedTitle = rfq.title;
        if (rfq.store?.name && sanitizedTitle) {
          // 移除店铺名称（格式：店铺名称 日期 序号 或 店铺名称 日期）
          const escapedStoreName = rfq.store.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const storeNamePattern = new RegExp(`^${escapedStoreName}\\s+`, 'i');
          sanitizedTitle = sanitizedTitle.replace(storeNamePattern, '');
        }
        return {
          ...rfq,
          title: sanitizedTitle,
          store: undefined, // 移除门店信息
        };
      });
    }
    
    return result;
  }

  async findOne(id: string, supplierId?: string, storeId?: string) {
    // 门店用户只能查看自己门店的询价单
    if (storeId) {
      const rfqCheck = await this.prisma.rfq.findUnique({
        where: { id },
        select: { storeId: true },
      });
      if (!rfqCheck) {
        throw new NotFoundException('询价单不存在');
      }
      if (rfqCheck.storeId !== storeId) {
        throw new BadRequestException('无权访问此询价单');
      }
    }

    // 先查询RFQ基本信息，用于判断是否需要盲拍
    const rfqBasic = await this.prisma.rfq.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    // 如果是供应商查询且询价单未关闭，需要查询所有报价来计算最低价
    const shouldCalculateMinPrice = supplierId && rfqBasic && rfqBasic.status !== 'CLOSED' && rfqBasic.status !== 'AWARDED';
    let allQuotesForMinPrice: any[] = [];
    
    if (shouldCalculateMinPrice) {
      // 查询所有报价（不包含报价者信息，用于计算最低价）
      allQuotesForMinPrice = await this.prisma.quote.findMany({
        where: {
          rfqId: id,
          status: 'SUBMITTED',
        },
        include: {
          items: {
            include: {
              rfqItem: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      });
    }

    // ⚠️ 供应商端不返回门店信息，保护门店隐私
    const isSupplier = !!supplierId;
    
    // 供应商查询时，仍然需要查询 store 信息（用于从 title 中移除店铺名称），但不返回给前端
    const rfq = await this.prisma.rfq.findUnique({
      where: { id },
      include: {
        store: true, // 临时查询 store 信息（用于处理 title）
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
          // 但为了显示最低价，我们需要查询所有报价（不返回报价者信息）
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
      
      // ⚠️ 供应商端不返回门店信息，保护门店隐私（双重保护）
      if (isSupplier && rfq.store) {
        // 从 title 中移除店铺名称
        if (rfq.store.name && rfq.title) {
          // 移除店铺名称（格式：店铺名称 日期 序号 或 店铺名称 日期）
          const storeNamePattern = new RegExp(`^${rfq.store.name}\\s+`, 'i');
          rfq.title = rfq.title.replace(storeNamePattern, '');
        }
        rfq.store = undefined as any;
      }

      // 如果是供应商查询且询价单未关闭，为每个商品添加最低价和一口价成交状态
      if (shouldCalculateMinPrice && rfq.items) {
        // 为每个商品计算最低价和一口价成交状态
        for (const item of rfq.items) {
          const itemQuotes = allQuotesForMinPrice.flatMap(quote => 
            quote.items
              .filter(qi => qi.rfqItemId === item.id)
              .map(qi => ({
                price: parseFloat(qi.price.toString()),
                submittedAt: quote.submittedAt || quote.createdAt,
              }))
          );

          if (itemQuotes.length > 0) {
            // 计算最低价
            const minPrice = Math.min(...itemQuotes.map(q => q.price));
            
            // 检查是否有一口价成交（有报价 <= 一口价）
            const instantPrice = item.instantPrice ? parseFloat(item.instantPrice.toString()) : null;
            const hasInstantPriceMatch = instantPrice && itemQuotes.some(q => q.price <= instantPrice);

            // 添加最低价和一口价成交状态到商品信息
            (item as any).minPrice = minPrice;
            (item as any).hasInstantPriceMatch = hasInstantPriceMatch;
            (item as any).priceStatus = hasInstantPriceMatch 
              ? '一口价已成交' 
              : `目前最低价=¥${minPrice.toFixed(2)}`;
          } else {
            // 没有报价
            (item as any).minPrice = null;
            (item as any).hasInstantPriceMatch = false;
            (item as any).priceStatus = null;
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

    const itemCount = rfq.items.length;
    // 只显示前5个商品名称，避免内容过长
    const itemNames = rfq.items
      .slice(0, 5)
      .map(item => item.productName)
      .join('、');
    const itemNamesText = itemCount > 5 
      ? `${itemNames} 等 ${itemCount} 个商品`
      : `${itemNames}（共 ${itemCount} 个商品）`;

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
        content: `询价单 ${rfq.rfqNo} 已发布，包含 ${itemNamesText}，截止时间：${new Date(rfq.deadline).toLocaleString('zh-CN')}`,
        link: `/quotes`, // 供应商应该通过报价管理页面访问询价单
        userName: supplier.username || undefined,
        sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
      });
    }

    // 通知门店用户（如果询价单关联了门店）- 只通知对应的门店，不是所有门店
    if (rfq.storeId) {
      const storeUsers = await this.prisma.user.findMany({
        where: {
          role: 'STORE',
          storeId: rfq.storeId, // 只查询对应门店的用户
          status: 'ACTIVE',
        },
        select: {
          id: true,
          username: true,
        },
      });

      for (const storeUser of storeUsers) {
        await this.notificationService.create({
          userId: storeUser.id,
          type: 'RFQ_PUBLISHED',
          title: '询价单已发布',
          content: `询价单 ${rfq.rfqNo} 已发布，包含 ${itemNamesText}，截止时间：${new Date(rfq.deadline).toLocaleString('zh-CN')}，发布人：${publisher?.username || '未知'}`,
          link: `/rfqs/${id}`,
          userName: storeUser.username || undefined,
          sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
        });
      }

      this.logger.debug(`已通知 ${storeUsers.length} 个门店用户关于询价单 ${rfq.rfqNo} 的发布`, {
        storeId: rfq.storeId,
        storeUsersCount: storeUsers.length,
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
        content: `询价单 ${rfq.rfqNo} 已发布，包含 ${itemNamesText}，截止时间：${new Date(rfq.deadline).toLocaleString('zh-CN')}，发布人：${publisher?.username || '未知'}`,
        link: `/rfqs/${id}`,
        userName: admin.username || undefined,
        sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
      });
    }

    // 发送一条汇总的钉钉消息到群里（避免重复）
    if (this.dingTalkService) {
      const dingTalkContent = `询价单 ${rfq.rfqNo} 已发布，包含 ${itemNamesText}，截止时间：${new Date(rfq.deadline).toLocaleString('zh-CN')}，发布人：${publisher?.username || '未知'}`;
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

      // 构建通知内容（简化版本，避免内容过长）
      // 只显示商品名称和数量，详细信息在采购页面查看
      const unquotedItemNames = unquotedItems
        .slice(0, 10) // 最多显示前10个商品，避免内容过长
        .map((item) => `${item.productName} × ${item.quantity}${item.unit || '件'}`)
        .join('、');
      
      const moreItemsCount = unquotedItems.length > 10 ? unquotedItems.length - 10 : 0;
      const itemListText = moreItemsCount > 0 
        ? `${unquotedItemNames} 等 ${unquotedItems.length} 个商品`
        : unquotedItemNames;

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

        // 为每个用户创建通知（简化内容，避免超过数据库字段限制）
        const notifications = await Promise.all(
          userIdsToNotify.map(userId =>
            this.notificationService.create({
              userId,
              type: 'RFQ_UNQUOTED_ITEMS',
              title: '询价单有未报价商品',
              content: `询价单 ${rfq.rfqNo} 已关闭，以下 ${unquotedItems.length} 个商品没有供应商报价，需要在拼多多/淘宝采购：${itemListText}。请前往采购页面查看详细信息。`,
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

    // 如果有报价，立即触发评标（直接调用，不通过队列，确保立即执行）
    if (rfq.quotes.length > 0) {
      this.logger.log(`询价单 ${rfq.rfqNo || id} 已手动关闭，开始自动评标...`);
      try {
        // 直接调用评标处理，确保立即执行
        await this.auctionQueue.processEvaluate({ data: { rfqId: id } });
        this.logger.log(`询价单 ${rfq.rfqNo || id} 自动评标完成`);
      } catch (error) {
        this.logger.error(`自动评标失败，询价单 ${rfq.rfqNo || id}:`, error);
        // 如果直接调用失败，尝试通过队列重试
        this.logger.log(`尝试通过队列重试评标...`);
        await this.auctionQueue.addEvaluateJob(id);
      }
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
      // 优化：直接通过 RfqItem.order 关系获取订单信息，而不是通过 order_rfqs 中间表
      // 使用类型断言，因为 Prisma Client 需要重新生成才能识别新的 relation
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
            // 直接通过 orderNo 关联的订单（推荐方式）
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
          } as any,
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
        // 保留 orders 关系用于兼容（但优先使用 item.order）
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
      // 使用类型断言确保 quotes 存在（因为我们在 include 中已经包含了它）
      const rfqWithQuotes = rfq as typeof rfq & { quotes: Array<{ items: Array<{ rfqItemId: string }> }> };
      const quotedItemIds = new Set(
        (rfqWithQuotes.quotes || []).flatMap((quote) => (quote.items || []).map((item) => item.rfqItemId))
      );

      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('查找未报价商品', {
          rfqNo: rfq.rfqNo,
          itemsCount: (rfq as any).items?.length || 0,
          quotesCount: (rfqWithQuotes.quotes || []).length,
          quotedItemsCount: quotedItemIds.size,
          ordersCount: (rfq as any).orders?.length || 0,
        });
      }

      // 找出未报价的商品
      // 优化：直接使用 item.order 获取订单信息，不再需要通过 order_rfqs 中间表匹配
      const rfqWithItems = rfq as typeof rfq & { items: Array<any>, store?: { name?: string } };
      for (const item of (rfqWithItems.items || [])) {
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
        
        // 直接使用 item.order 获取订单信息（通过 orderNo 关联）
        // 这是最直接、最准确的方式，避免了复杂的匹配逻辑
        // 使用类型断言访问 order，因为 Prisma Client 需要重新生成才能识别新的 relation
        const order = (item as any).order;
        
        // 调试日志：记录订单信息（无论开发还是生产环境都记录，便于排查）
        this.logger.debug('订单信息查询', {
          rfqNo: rfq.rfqNo,
          itemId: item.id,
          productName: item.productName,
          itemOrderNo: item.orderNo,
          hasOrder: !!order,
          orderNo: order?.orderNo,
          hasRecipient: !!order?.recipient,
          hasPhone: !!order?.phone,
          hasAddress: !!order?.address,
        });
        
        // 门店信息：优先使用订单的门店信息，如果没有则使用询价单的门店信息
        const storeId = order?.storeId || rfq.storeId || undefined;
        const storeName = order?.store?.name || (rfq as any).store?.name || undefined;
        
        // 构建未报价商品项，直接使用 item.order 的订单信息
        // 确保所有订单相关字段都明确返回（即使值为 null/undefined）
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
            // 订单信息（直接从 item.order 获取，确保字段存在）
            orderNo: order?.orderNo || item.orderNo || null,
            orderTime: order?.orderTime || null,
            userNickname: order?.userNickname || null,
            openid: order?.openid || null,
            recipient: order?.recipient || null,
            phone: order?.phone || null,
            address: order?.address || null,
            modifiedAddress: order?.modifiedAddress || null,
            orderPrice: order?.price ? Number(order.price) : null,
            points: order?.points || null,
            orderStatus: order?.status || null,
            // 门店信息：优先使用订单的门店，如果没有则使用询价单的门店
            storeId: storeId,
            storeName: storeName,
            shippedAt: order?.shippedAt || null,
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
          } as any, // Type assertion for items include
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
      const rfqWithOrders = rfq as any; // 类型断言，因为 Prisma 类型可能未更新
      for (const item of rfqWithOrders.items) {
        // 查找该商品的中标信息
        // 注意：一个 RFQ 可以有多个 Award（每个供应商一个），需要找到真正中标该商品的供应商
        // 逻辑：优先查找 Award 记录，确定中标供应商（支持手动选商），如果没有 Award，才考虑价格和提交时间
        let award = null;
        let winningQuoteItem = null;
        
        if (item.itemStatus === 'AWARDED' && item.quoteItems && item.quoteItems.length > 0) {
          // 优先查找 Award 记录，确定中标供应商（与 findByBuyer 逻辑一致）
          const candidateQuoteItems: Array<{ award: any; quoteItem: any; price: number; submittedAt: Date }> = [];
          
          // 查找该商品的中标报价项（通过 Award 记录）
          if (rfqWithOrders.awards && rfqWithOrders.awards.length > 0) {
            for (const a of rfqWithOrders.awards) {
              // 只考虑 ACTIVE 的 Award
              if (a.status !== 'ACTIVE') continue;
              
              // 如果该 Award 对应的报价中有该商品的报价项，说明该供应商中标了
              if (a.quote && a.quote.items && a.quote.items.length > 0) {
                const awardedQuoteItem = a.quote.items.find((qi: any) => qi.rfqItemId === item.id);
                if (awardedQuoteItem) {
                  // 验证该报价项确实存在于 item.quoteItems 中
                  const matchingQuoteItem = item.quoteItems.find((qi: any) => qi.id === awardedQuoteItem.id);
                  if (matchingQuoteItem) {
                    candidateQuoteItems.push({
                      award: a,
                      quoteItem: matchingQuoteItem,
                      price: parseFloat(matchingQuoteItem.price.toString()),
                      submittedAt: matchingQuoteItem.quote?.submittedAt || matchingQuoteItem.quote?.createdAt || new Date(),
                    });
                  }
                }
              }
            }
          }
          
          // 如果有多个候选，优先选择满足一口价的（如果有一口价），然后选择价格最低的（如果价格相同，选择最早提交的）
          if (candidateQuoteItems.length > 0) {
            const instantPrice = item.instantPrice ? parseFloat(item.instantPrice.toString()) : null;
            
            // 如果有一口价，优先选择满足一口价的报价
            if (instantPrice) {
              const instantPriceCandidates = candidateQuoteItems.filter(
                candidate => candidate.price <= instantPrice
              );
              
              if (instantPriceCandidates.length > 0) {
                // 在满足一口价的候选中，按提交时间排序（最早提交的优先）
                instantPriceCandidates.sort((a, b) => {
                  return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
                });
                winningQuoteItem = instantPriceCandidates[0].quoteItem;
                award = instantPriceCandidates[0].award;
              } else {
                // 没有满足一口价的，按价格排序
                candidateQuoteItems.sort((a, b) => {
                  if (a.price !== b.price) {
                    return a.price - b.price; // 价格优先
                  }
                  // 价格相同，按提交时间排序（最早提交的优先）
                  return new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime();
                });
                winningQuoteItem = candidateQuoteItems[0].quoteItem;
                award = candidateQuoteItems[0].award;
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
              
              winningQuoteItem = candidateQuoteItems[0].quoteItem;
              award = candidateQuoteItems[0].award;
            }
          }
          
          // 如果没有找到 Award 记录，优先选择满足一口价的报价（如果有一口价），否则使用价格最低的报价项（自动选商）
          if (!winningQuoteItem) {
            const instantPrice = item.instantPrice ? parseFloat(item.instantPrice.toString()) : null;
            
            if (instantPrice) {
              // 如果有一口价，优先选择满足一口价的报价，按提交时间排序（最早提交的优先）
              const instantPriceQuotes = item.quoteItems
                .filter((qi: any) => parseFloat(qi.price.toString()) <= instantPrice)
                .sort((a: any, b: any) => {
                  const aTime = a.quote?.submittedAt || a.quote?.createdAt || new Date();
                  const bTime = b.quote?.submittedAt || b.quote?.createdAt || new Date();
                  return new Date(aTime).getTime() - new Date(bTime).getTime();
                });
              
              if (instantPriceQuotes.length > 0) {
                winningQuoteItem = instantPriceQuotes[0];
              }
            }
            
            // 如果没有满足一口价的报价，或者没有一口价，使用价格最低的报价项
            if (!winningQuoteItem) {
              winningQuoteItem = item.quoteItems.reduce((best: any, current: any) => {
                const bestPrice = parseFloat(best.price.toString());
                const currentPrice = parseFloat(current.price.toString());
                if (currentPrice < bestPrice) {
                  return current;
                } else if (currentPrice === bestPrice) {
                  // 价格相同，选择最早提交的
                  const bestTime = best.quote?.submittedAt || best.quote?.createdAt || new Date();
                  const currentTime = current.quote?.submittedAt || current.quote?.createdAt || new Date();
                  return new Date(currentTime).getTime() < new Date(bestTime).getTime() ? current : best;
                }
                return best;
              });
            }
          }
        }

        // 查找该商品的发货信息（供应商发货）
        // 优先查找换货发货单（shipmentNo 以 REPLACE- 开头），如果没有则查找原始发货单
        const allSupplierShipments = item.shipments?.filter(s => s.source === 'SUPPLIER') || [];
        const replacementShipment = allSupplierShipments.find(s => s.shipmentNo?.startsWith('REPLACE-'));
        const supplierShipment = replacementShipment || allSupplierShipments[0];
        
        // 直接使用 item.order 获取订单信息（通过 orderNo 关联）
        // 参考 findUnquotedItems 的实现方式，这是最直接、最准确的方式
        const order = (item as any).order;
        
        // 调试日志：记录订单信息（参考 findUnquotedItems 的实现）
        // 在生产环境也记录，便于排查问题
        this.logger.log('订单信息查询', {
          rfqNo: rfq.rfqNo,
          itemId: item.id,
          productName: item.productName,
          itemOrderNo: item.orderNo,
          hasOrder: !!order,
          orderNo: order?.orderNo,
          hasRecipient: !!order?.recipient,
          hasPhone: !!order?.phone,
          hasAddress: !!order?.address,
          // 如果 order 为 undefined，可能是 Prisma Client 未重新生成
          orderType: order === undefined ? 'undefined (可能需要运行 prisma generate)' : typeof order,
        });

        // 判断发货状态
        // 判断逻辑：
        // 1. 如果有 Shipment 记录且 source 为 'SUPPLIER'，且是真正中标供应商的，说明供应商已发货 → "已发货"
        // 2. 如果 RfqItem 的 source 为 'ECOMMERCE'，说明是电商采购 → "电商采购"
        // 3. 如果没有供应商（未中标），自动归类为电商采购 → "电商采购"
        // 4. 如果已中标但没有正确供应商的 Shipment 记录，说明未发货 → "未发货"
        // 5. 如果 item.trackingNo 存在但不是真正中标供应商的，忽略它（可能是错误数据）
        let shipmentStatus: 'SHIPPED' | 'NOT_SHIPPED' | 'ECOMMERCE' = 'NOT_SHIPPED';
        let supplierId: string | undefined;
        let supplierName: string | undefined;
        let trackingNo: string | undefined;
        let carrier: string | undefined;
        let awardedPrice: number | undefined;
        let shipmentCreatedAt: Date | undefined;

        // 获取真正中标供应商的 ID
        const winningSupplierId = winningQuoteItem?.quote?.supplierId || award?.supplierId;

        // 优先检查供应商发货（Shipment 记录，source 为 'SUPPLIER'）
        // 供应商上传物流单号时会创建 Shipment 记录，source 为 'SUPPLIER'
        // ⚠️ 重要：只接受真正中标供应商的发货单
        if (supplierShipment && supplierShipment.source === 'SUPPLIER') {
          // 验证发货单的供应商是否是真正中标的供应商
          const isCorrectSupplier = winningSupplierId && supplierShipment.supplierId === winningSupplierId;
          
          if (isCorrectSupplier || !winningSupplierId) {
            // 如果发货单的供应商是真正中标的供应商，或者商品未中标（winningSupplierId 为空），则接受该发货单
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
            // 订单信息（直接从 item.order 获取，参考 findUnquotedItems 的实现）
            orderNo: order?.orderNo || item.orderNo || null,
            recipient: order?.recipient || null,
            phone: order?.phone || null,
            address: order?.modifiedAddress || order?.address || null,
            userNickname: order?.userNickname || null,
            openid: order?.openid || null,
            orderPrice: order?.price ? Number(order.price) : null,
            points: order?.points || null,
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
            storeName: rfqWithOrders.store?.name || undefined,
            storeCode: rfqWithOrders.store?.code || undefined,
            isReplacement,
            shipmentNo: supplierShipment.shipmentNo,
          });
          continue; // 跳过后续逻辑，已处理完成
          } else {
            // 发货单存在但不是真正中标供应商的，忽略它（可能是错误数据）
            // 继续后续逻辑，判断为未发货或电商采购
            this.logger.warn(`发货单的供应商不是真正中标的供应商`, {
              rfqNo: rfq.rfqNo,
              itemId: item.id,
              productName: item.productName,
              shipmentSupplierId: supplierShipment.supplierId,
              winningSupplierId: winningSupplierId,
            });
          }
        } 
        // ⚠️ 重要：如果商品已中标，即使有 trackingNo 但没有正确供应商的 supplierShipment，
        // 应该显示为"未发货"，而不是"电商采购"
        // 检查是否已中标
        else if (winningQuoteItem || award) {
          // 已中标但未发货（没有正确供应商的 supplierShipment）
          // 即使 rfq_items 中有 trackingNo，也可能是错误数据，应该忽略
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
        // 检查电商平台采购（RfqItem 的 source 为 'ECOMMERCE'）
        // 采购员在电商采购清单中更新物流单号时，会设置 RfqItem 的 source 为 'ECOMMERCE'
        else if (item.source === 'ECOMMERCE') {
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

        overview.push({
          rfqId: rfq.id,
          rfqNo: rfq.rfqNo,
          rfqTitle: rfq.title,
          itemId: item.id,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit || '件',
          // 订单信息（直接从 item.order 获取，参考 findUnquotedItems 的实现）
          orderNo: order?.orderNo || item.orderNo || null,
          recipient: order?.recipient || null,
          phone: order?.phone || null,
          address: order?.modifiedAddress || order?.address || null,
          userNickname: order?.userNickname || null,
          openid: order?.openid || null,
          orderPrice: order?.price ? Number(order.price) : null,
          points: order?.points || null,
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
          storeName: rfqWithOrders.store?.name || undefined,
          storeCode: rfqWithOrders.store?.code || undefined,
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

    // ⚠️ 重要：在更新商品状态前，先检查该商品是否已经被其他供应商的 quote 包含
    // 如果有，需要撤销之前包含该商品的 quote 的 AWARDED 状态
    const previousQuotesWithThisItem = await this.prisma.quoteItem.findMany({
      where: {
        rfqItemId: rfqItemId,
        quoteId: { not: quoteId }, // 排除当前要中标的 quote
      },
      include: {
        quote: {
          select: {
            id: true,
            status: true,
            supplierId: true,
          },
        },
      },
    });

    // 查找之前包含该商品且状态为 AWARDED 的 quote
    const previousAwardedQuotes = previousQuotesWithThisItem.filter(
      qi => qi.quote.status === 'AWARDED'
    );

    // 对于每个之前包含该商品的 AWARDED quote，需要撤销或降级
    for (const previousQuoteItem of previousAwardedQuotes) {
      const previousQuoteId = previousQuoteItem.quote.id;
      const previousSupplierId = previousQuoteItem.quote.supplierId;

      this.logger.debug('发现之前包含该商品的 AWARDED quote，需要撤销或降级', {
        previousQuoteId,
        previousSupplierId,
        rfqItemId,
        currentQuoteId: quoteId,
      });

      // 检查该 quote 是否还有其他真正中标的商品
      const previousQuoteAllItems = await this.prisma.quoteItem.findMany({
        where: {
          quoteId: previousQuoteId,
        },
        include: {
          rfqItem: {
            select: {
              id: true,
              itemStatus: true,
            },
          },
        },
      });

      // 检查该 quote 的其他商品是否真的由该供应商中标
      let otherAwardedCount = 0;
      for (const otherQuoteItem of previousQuoteAllItems) {
        if (otherQuoteItem.rfqItemId === rfqItemId) {
          continue; // 跳过当前商品
        }

        if (otherQuoteItem.rfqItem.itemStatus !== 'AWARDED') {
          continue; // 商品未中标，跳过
        }

        // 查询该商品的所有报价，找到真正中标的报价
        const allQuotesForOtherItem = await this.prisma.quoteItem.findMany({
          where: {
            rfqItemId: otherQuoteItem.rfqItemId,
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

        // 优先查找 Award 记录，确定中标供应商
        const awardsForOtherItem = await this.prisma.award.findMany({
          where: {
            rfqId,
            status: { not: 'CANCELLED' },
          },
          include: {
            quote: {
              include: {
                items: {
                  where: {
                    rfqItemId: otherQuoteItem.rfqItemId,
                  },
                },
              },
            },
          },
        });

        let bestQuoteItemForOther: any = null;
        for (const award of awardsForOtherItem) {
          if (award.quote.items && award.quote.items.length > 0) {
            const awardedQuoteItem = award.quote.items[0];
            const matchingQuoteItem = allQuotesForOtherItem.find(qi => qi.id === awardedQuoteItem.id);
            if (matchingQuoteItem) {
              bestQuoteItemForOther = matchingQuoteItem;
              break;
            }
          }
        }

        // 如果没有找到 Award 记录，使用价格最低的报价项
        if (!bestQuoteItemForOther && allQuotesForOtherItem.length > 0) {
          const sortedQuoteItems = allQuotesForOtherItem.sort((a, b) => {
            const priceA = parseFloat(a.price.toString());
            const priceB = parseFloat(b.price.toString());
            return priceA - priceB;
          });
          bestQuoteItemForOther = sortedQuoteItems[0];
        }

        // 验证该商品是否真的是由该报价的供应商中标的
        if (bestQuoteItemForOther && 
            bestQuoteItemForOther.quote.supplierId === previousSupplierId && 
            bestQuoteItemForOther.id === otherQuoteItem.id) {
          otherAwardedCount++;
        }
      }

      // ⚠️ 重要：先重新计算 quote.price，然后再决定是否降级 status
      // 查询该 quote 的所有商品，看哪些商品真的中标了
      const previousQuoteAllItemsForPrice = await this.prisma.quoteItem.findMany({
        where: {
          quoteId: previousQuoteId,
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

      // 计算真正中标的商品的总价（排除当前商品）
      let previousQuoteAwardedTotalPrice = 0;
      for (const qi of previousQuoteAllItemsForPrice) {
        if (qi.rfqItemId === rfqItemId) {
          continue; // 跳过当前商品（即将被其他供应商中标）
        }

        if (qi.rfqItem.itemStatus === 'AWARDED') {
          // 检查该商品是否真的由该报价的供应商中标
          // 这里简化处理：如果商品已中标且该报价包含该商品，就计入总价
          // 更严格的验证在上面已经做了
          previousQuoteAwardedTotalPrice += parseFloat(qi.price.toString()) * (qi.rfqItem.quantity || 1);
        }
      }

      // 如果该 quote 没有其他真正中标的商品，将 status 从 AWARDED 改为 SUBMITTED
      if (otherAwardedCount === 0) {
        await this.prisma.quote.update({
          where: { id: previousQuoteId },
          data: { 
            status: 'SUBMITTED',
            price: previousQuoteAwardedTotalPrice, // ⚠️ 重要：更新 price，只包含真正中标的商品（排除当前商品）
          },
        });
        this.logger.log('已将之前包含该商品的 quote 状态从 AWARDED 改为 SUBMITTED，并更新了 price', {
          previousQuoteId,
          previousSupplierId,
          newPrice: previousQuoteAwardedTotalPrice,
          removedItem: rfqItem.productName,
          reason: '该 quote 没有其他真正中标的商品',
        });
      } else {
        // 如果该 quote 还有其他真正中标的商品，保持 AWARDED 状态
        // 但需要更新 quote.price 和 Award 记录的 finalPrice（减去该商品的价格）
        await this.prisma.quote.update({
          where: { id: previousQuoteId },
          data: {
            price: previousQuoteAwardedTotalPrice, // ⚠️ 重要：更新 price，只包含真正中标的商品（排除当前商品）
          },
        });
        this.logger.log('该 quote 还有其他真正中标的商品，保持 AWARDED 状态，但更新了 price', {
          previousQuoteId,
          previousSupplierId,
          otherAwardedCount,
          newPrice: previousQuoteAwardedTotalPrice,
          removedItem: rfqItem.productName,
        });
      }

      // 更新该 quote 对应的 Award 记录的 finalPrice
      const previousAward = await this.prisma.award.findUnique({
        where: {
          rfqId_supplierId: {
            rfqId,
            supplierId: previousSupplierId,
          },
        },
      });

      if (previousAward) {
        // 重新计算该供应商在该 RFQ 中所有真正中标的商品的总价
        const previousAwardedItems = await this.prisma.rfqItem.findMany({
          where: {
            rfqId,
            itemStatus: 'AWARDED',
          },
          include: {
            quoteItems: {
              where: {
                quote: {
                  supplierId: previousSupplierId,
                },
              },
              include: {
                quote: true,
              },
            },
          },
        });

        let previousTotalPrice = 0;
        for (const item of previousAwardedItems) {
          // 检查该商品是否真的由该供应商中标
          if (item.id === rfqItemId) {
            continue; // 跳过当前商品（即将被其他供应商中标）
          }

          if (item.quoteItems && item.quoteItems.length > 0) {
            // 查询该商品的所有报价，找到真正中标的报价
            const allQuotesForItem = await this.prisma.quoteItem.findMany({
              where: {
                rfqItemId: item.id,
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

            // 优先查找 Award 记录，确定中标供应商
            const awardsForItem = await this.prisma.award.findMany({
              where: {
                rfqId,
                status: { not: 'CANCELLED' },
              },
              include: {
                quote: {
                  include: {
                    items: {
                      where: {
                        rfqItemId: item.id,
                      },
                    },
                  },
                },
              },
            });

            let bestQuoteItemForItem: any = null;
            for (const award of awardsForItem) {
              if (award.quote.items && award.quote.items.length > 0) {
                const awardedQuoteItem = award.quote.items[0];
                const matchingQuoteItem = allQuotesForItem.find(qi => qi.id === awardedQuoteItem.id);
                if (matchingQuoteItem && matchingQuoteItem.quote.supplierId === previousSupplierId) {
                  bestQuoteItemForItem = matchingQuoteItem;
                  break;
                }
              }
            }

            // 如果没有找到 Award 记录，使用价格最低的报价项
            if (!bestQuoteItemForItem && allQuotesForItem.length > 0) {
              const supplierQuoteItems = allQuotesForItem.filter(qi => qi.quote.supplierId === previousSupplierId);
              if (supplierQuoteItems.length > 0) {
                bestQuoteItemForItem = supplierQuoteItems.reduce((best, current) => {
                  const bestPrice = parseFloat(best.price.toString());
                  const currentPrice = parseFloat(current.price.toString());
                  return currentPrice < bestPrice ? current : best;
                });
              }
            }

            if (bestQuoteItemForItem) {
              previousTotalPrice += parseFloat(bestQuoteItemForItem.price.toString()) * (item.quantity || 1);
            }
          }
        }

        await this.prisma.award.update({
          where: { id: previousAward.id },
          data: {
            finalPrice: previousTotalPrice,
            reason: previousAward.reason 
              ? `${previousAward.reason}；已移除商品：${rfqItem.productName}`
              : `手动选商（按商品级别），已移除商品：${rfqItem.productName}`,
            updatedAt: new Date(),
          },
        });
        this.logger.log('已更新之前包含该商品的 Award 记录的 finalPrice', {
          previousAwardId: previousAward.id,
          previousSupplierId,
          newFinalPrice: previousTotalPrice,
          removedItem: rfqItem.productName,
        });
      } else {
        // 如果没有 Award 记录，但 quote 状态是 AWARDED，说明数据不一致
        // 这种情况下，我们仍然需要更新 quote 的 status 和 price（已在上面处理）
        this.logger.warn('之前包含该商品的 quote 状态是 AWARDED，但没有对应的 Award 记录', {
          previousQuoteId,
          previousSupplierId,
          rfqItemId,
        });
      }
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
        quote: {
          select: {
            supplierId: true,
          },
        },
      },
    });

    // ⚠️ 重要：验证每个商品是否真的是由该报价的供应商中标的
    // 不能只检查 itemStatus === 'AWARDED'，因为其他供应商报价的商品也可能被标记为 AWARDED
    const supplierId = quoteItem.quote.supplierId;
    let actuallyAwardedCount = 0;

    for (const quoteItemRecord of quoteAllItems) {
      if (quoteItemRecord.rfqItem.itemStatus !== 'AWARDED') {
        continue; // 商品未中标，跳过
      }

      // 查询该商品的所有报价，找到真正中标的报价
      const allQuotesForItem = await this.prisma.quoteItem.findMany({
        where: {
          rfqItemId: quoteItemRecord.rfqItemId,
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

      // 优先查找 Award 记录，确定中标供应商
      const rfqIdForItem = quoteItemRecord.rfqItem.rfqId;
      let bestQuoteItem: any = null;

      const awards = await this.prisma.award.findMany({
        where: {
          rfqId: rfqIdForItem,
          status: { not: 'CANCELLED' },
        },
        include: {
          quote: {
            include: {
              items: {
                where: {
                  rfqItemId: quoteItemRecord.rfqItemId,
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
          const matchingQuoteItem = allQuotesForItem.find(qi => qi.id === awardedQuoteItem.id);
          if (matchingQuoteItem) {
            bestQuoteItem = matchingQuoteItem;
            break;
          }
        }
      }

      // 如果没有找到 Award 记录，使用价格最低的报价项（自动选商）
      if (!bestQuoteItem && allQuotesForItem.length > 0) {
        const sortedQuoteItems = allQuotesForItem.sort((a, b) => {
          const priceA = parseFloat(a.price.toString());
          const priceB = parseFloat(b.price.toString());
          return priceA - priceB;
        });
        bestQuoteItem = sortedQuoteItems[0];
      }

      // 验证该商品是否真的是由该报价的供应商中标的
      if (bestQuoteItem && bestQuoteItem.quote.supplierId === supplierId && bestQuoteItem.id === quoteItemRecord.id) {
        actuallyAwardedCount++;
        this.logger.debug('验证通过：该报价的供应商确实中标了此商品', {
          rfqItemId: quoteItemRecord.rfqItemId,
          quoteItemId: quoteItemRecord.id,
          supplierId,
        });
      } else {
        this.logger.debug('验证失败：该报价的供应商未中标此商品', {
          rfqItemId: quoteItemRecord.rfqItemId,
          quoteItemId: quoteItemRecord.id,
          supplierId,
          bestQuoteItemSupplierId: bestQuoteItem?.quote?.supplierId,
          bestQuoteItemId: bestQuoteItem?.id,
        });
      }
    }

    // 只有真正中标的商品数量 > 0 时，才更新报价状态为 AWARDED
    if (actuallyAwardedCount > 0) {
      // ⚠️ 重要：重新计算 quote.price，只包含真正中标的商品
      let awardedTotalPrice = 0;
      for (const quoteItemRecord of quoteAllItems) {
        if (quoteItemRecord.rfqItem.itemStatus !== 'AWARDED') {
          continue; // 商品未中标，跳过
        }

        // 查询该商品的所有报价，找到真正中标的报价
        const allQuotesForItem = await this.prisma.quoteItem.findMany({
          where: {
            rfqItemId: quoteItemRecord.rfqItemId,
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

        // 优先查找 Award 记录，确定中标供应商
        const awardsForItem = await this.prisma.award.findMany({
          where: {
            rfqId,
            status: { not: 'CANCELLED' },
          },
          include: {
            quote: {
              include: {
                items: {
                  where: {
                    rfqItemId: quoteItemRecord.rfqItemId,
                  },
                },
              },
            },
          },
        });

        let bestQuoteItemForItem: any = null;
        for (const award of awardsForItem) {
          if (award.quote.items && award.quote.items.length > 0) {
            const awardedQuoteItem = award.quote.items[0];
            const matchingQuoteItem = allQuotesForItem.find(qi => qi.id === awardedQuoteItem.id);
            if (matchingQuoteItem) {
              bestQuoteItemForItem = matchingQuoteItem;
              break;
            }
          }
        }

        // 如果没有找到 Award 记录，使用价格最低的报价项
        if (!bestQuoteItemForItem && allQuotesForItem.length > 0) {
          const sortedQuoteItems = allQuotesForItem.sort((a, b) => {
            const priceA = parseFloat(a.price.toString());
            const priceB = parseFloat(b.price.toString());
            return priceA - priceB;
          });
          bestQuoteItemForItem = sortedQuoteItems[0];
        }

        // 验证该商品是否真的是由该报价的供应商中标的
        if (bestQuoteItemForItem && 
            bestQuoteItemForItem.quote.supplierId === supplierId && 
            bestQuoteItemForItem.id === quoteItemRecord.id) {
          awardedTotalPrice += parseFloat(quoteItemRecord.price.toString()) * (quoteItemRecord.rfqItem.quantity || 1);
        }
      }

      await this.prisma.quote.update({
        where: { id: quoteId },
        data: { 
          status: 'AWARDED',
          price: awardedTotalPrice, // ⚠️ 重要：更新 price，只包含真正中标的商品
        },
      });
      this.logger.debug('报价状态已更新为 AWARDED，price 已重新计算', {
        quoteId,
        actuallyAwardedCount,
        totalCount: quoteAllItems.length,
        supplierId,
        awardedTotalPrice,
      });
    } else {
      this.logger.debug('报价没有真正中标的商品，不更新状态为 AWARDED', {
        quoteId,
        supplierId,
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

    // ⚠️ 关键修复：在创建新 Award 之前，先取消同一商品其他供应商的 ACTIVE Award
    // 确保一个商品只有一个 ACTIVE 的 Award 记录
    const otherAwardsForItem = await this.prisma.award.findMany({
      where: {
        rfqId,
        status: 'ACTIVE',
        supplierId: { not: supplierId }, // 排除当前供应商
      },
      include: {
        quote: {
          include: {
            items: {
              where: {
                rfqItemId: rfqItemId, // 只查找包含该商品的 Award
              },
            },
          },
        },
      },
    });

    // 取消其他供应商的 Award（如果他们的 quote 包含该商品）
    for (const otherAward of otherAwardsForItem) {
      if (otherAward.quote.items && otherAward.quote.items.length > 0) {
        // 该 Award 对应的 quote 包含该商品，需要取消
        await this.prisma.award.update({
          where: { id: otherAward.id },
          data: {
            status: 'CANCELLED',
            cancellationReason: 'MANUAL_REAWARD',
            cancelledAt: new Date(),
          },
        });
        this.logger.log('取消其他供应商的 Award（手动选商：商品重新选商）', {
          cancelledAwardId: otherAward.id,
          cancelledSupplierId: otherAward.supplierId,
          newSupplierId: supplierId,
          rfqItemId,
        });
      }
    }

    // 创建或更新 Award 记录（用于兼容性）
    // 注意：现在一个 RFQ 可以有多个 Award（每个供应商一个），所以需要通过 rfqId 和 supplierId 查找
    // supplierId 已在上面声明，这里直接使用
    const existingAward = await this.prisma.award.findUnique({
      where: {
        rfqId_supplierId: {
          rfqId,
          supplierId,
        },
      },
    });

    // ⚠️ 重要：找到该供应商包含最多中标商品的 Quote
    // 因为一个供应商可能对同一个 RFQ 有多个 Quote，需要选择最合适的
    const allAwardedItems = await this.prisma.rfqItem.findMany({
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

    // 统计每个 Quote 包含的中标商品数量
    const quoteItemCountMap = new Map<string, number>();
    for (const item of allAwardedItems) {
      if (item.quoteItems && item.quoteItems.length > 0) {
        for (const quoteItem of item.quoteItems) {
          const count = quoteItemCountMap.get(quoteItem.quote.id) || 0;
          quoteItemCountMap.set(quoteItem.quote.id, count + 1);
        }
      }
    }

    // 找到包含最多中标商品的 Quote，如果数量相同，选择最早提交的
    let bestQuoteId = quoteId; // 默认使用传入的 quoteId
    let maxItemCount = quoteItemCountMap.get(quoteId) || 0;
    let earliestSubmittedAt: Date | null = null;

    // 获取所有该供应商的 Quote 信息
    const supplierQuotes = await this.prisma.quote.findMany({
      where: {
        rfqId,
        supplierId,
      },
      select: {
        id: true,
        submittedAt: true,
        createdAt: true,
      },
    });

    for (const [quoteIdInMap, itemCount] of quoteItemCountMap.entries()) {
      const quote = supplierQuotes.find(q => q.id === quoteIdInMap);
      if (!quote) continue;

      if (itemCount > maxItemCount) {
        maxItemCount = itemCount;
        bestQuoteId = quoteIdInMap;
        earliestSubmittedAt = quote.submittedAt || quote.createdAt;
      } else if (itemCount === maxItemCount && quote.submittedAt) {
        // 如果商品数量相同，选择最早提交的
        if (!earliestSubmittedAt || quote.submittedAt < earliestSubmittedAt) {
          bestQuoteId = quoteIdInMap;
          earliestSubmittedAt = quote.submittedAt;
        }
      }
    }

    if (!existingAward) {
      // 创建汇总的 Award 记录
      const totalPrice = parseFloat(quoteItem.price.toString()) * (rfqItem.quantity || 1);
      
      await this.prisma.award.create({
        data: {
          rfqId,
          quoteId: bestQuoteId, // 使用包含最多中标商品的 Quote
          supplierId,
          finalPrice: totalPrice,
          reason: `手动选商（按商品级别）：${rfqItem.productName}`,
          items: {
            create: {
              rfqItemId: rfqItemId,
              quoteItemId: quoteItem.id,
              price: parseFloat(quoteItem.price.toString()),
              quantity: rfqItem.quantity || 1,
            },
          },
        },
      });
      this.logger.debug('创建了汇总 Award 记录', { rfqId, supplierId, bestQuoteId });
    } else {
      // 更新现有 Award 记录的总价和 quoteId
      // 注意：应该使用该供应商的实际中标报价，而不是最低价
      let totalPrice = 0;
      for (const item of allAwardedItems) {
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
          quoteId: bestQuoteId, // 更新为包含最多中标商品的 Quote
          finalPrice: totalPrice,
          reason: `手动选商（按商品级别），共 ${allAwardedItems.filter(item => {
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

    // 通知门店用户（如果询价单关联了门店）- 只通知对应的门店，不是所有门店
    if (rfq.storeId) {
      const storeUsers = await this.prisma.user.findMany({
        where: {
          role: 'STORE',
          storeId: rfq.storeId, // 只查询对应门店的用户
          status: 'ACTIVE',
        },
        select: {
          id: true,
          username: true,
        },
      });

      for (const storeUser of storeUsers) {
        await this.notificationService.create({
          userId: storeUser.id,
          type: 'QUOTE_AWARDED',
          title: '报价中标通知',
          content: `供应商 ${supplier?.username || '未知'} 在询价单 ${rfq.rfqNo} 中的商品 "${rfqItem.productName}" 已中标，价格 ¥${parseFloat(quoteItem.price.toString()).toFixed(2)}/件`,
          link: `/rfqs/${rfqId}`,
          userName: storeUser.username || undefined,
          sendDingTalk: false, // 批量通知时不发送钉钉，避免重复
        });
      }

      this.logger.debug(`已通知 ${storeUsers.length} 个门店用户关于报价中标`, {
        rfqNo: rfq.rfqNo,
        storeId: rfq.storeId,
        storeUsersCount: storeUsers.length,
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

    // 删除规则：
    // 1. 草稿状态：可以删除（无限制）
    // 2. 已发布但无报价：可以删除
    // 3. 已发布且有报价：管理员可以强制删除，其他角色不能删除
    // 4. 已关闭/已选商/已取消：管理员可以强制删除，其他角色不能删除
    // 5. 有中标记录：管理员可以强制删除，其他角色不能删除
    
    const isAdmin = user.role === 'ADMIN';
    const canForceDelete = isAdmin;
    
    // 如果状态不是草稿，需要检查是否可以删除
    if (rfq.status !== 'DRAFT') {
      // 检查是否有报价
      if (rfq.quotes && rfq.quotes.length > 0) {
        if (!canForceDelete) {
          throw new BadRequestException('该询价单已有报价，只有管理员可以强制删除');
        }
        // 管理员可以强制删除，但需要警告
        this.logger.warn(`管理员强制删除有报价的询价单: ${rfq.rfqNo}`, {
          rfqId: id,
          userId,
          quotesCount: rfq.quotes.length,
        });
      }
      
      // 检查是否有中标记录
      if (rfq.awards && rfq.awards.length > 0) {
        if (!canForceDelete) {
          throw new BadRequestException('该询价单已有中标记录，只有管理员可以强制删除');
        }
        // 管理员可以强制删除，但需要警告
        this.logger.warn(`管理员强制删除有中标记录的询价单: ${rfq.rfqNo}`, {
          rfqId: id,
          userId,
          awardsCount: rfq.awards.length,
        });
      }
      
      // 非管理员且不是草稿状态，不能删除（这个检查已经在 if 块外面了，所以这里不需要再检查）
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

  /**
   * 删除询价单中的单个商品（仅管理员）
   */
  async deleteRfqItem(itemId: string, userId: string) {
    // 查找商品
    const rfqItem = await this.prisma.rfqItem.findUnique({
      where: { id: itemId },
      include: {
        rfq: {
          select: {
            id: true,
            rfqNo: true,
            title: true,
            status: true,
          },
        },
        quoteItems: {
          include: {
            quote: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        },
      },
    });

    if (!rfqItem) {
      throw new BadRequestException('商品不存在');
    }

    // 检查询价单状态
    if (rfqItem.rfq.status === 'CLOSED' && rfqItem.itemStatus === 'AWARDED') {
      // 如果商品已中标，需要警告管理员
      this.logger.warn(`管理员删除已中标的商品: ${rfqItem.productName}`, {
        itemId,
        rfqId: rfqItem.rfqId,
        rfqNo: rfqItem.rfq.rfqNo,
        userId,
      });
    }

    // 使用事务删除相关数据
    await this.prisma.$transaction(async (tx) => {
      // 1. 删除关联的报价项（quote_items）
      await tx.quoteItem.deleteMany({
        where: { rfqItemId: itemId },
      });

      // 2. 删除关联的发货单（shipments）
      await tx.shipment.deleteMany({
        where: { rfqItemId: itemId },
      });

      // 3. 检查并更新相关的 Award 记录
      // 如果某个 Award 的 quote 中只剩下这一个商品，需要取消该 Award
      const awardsWithThisItem = await tx.award.findMany({
        where: {
          rfqId: rfqItem.rfqId,
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

      for (const award of awardsWithThisItem) {
        // 检查该 Award 的 quote 中是否包含这个商品
        const hasThisItem = award.quote.items.some((qi: any) => qi.rfqItemId === itemId);
        if (hasThisItem) {
          // 如果该 Award 的 quote 中只剩下这一个商品，取消该 Award
          const remainingItems = award.quote.items.filter((qi: any) => qi.rfqItemId !== itemId);
          if (remainingItems.length === 0) {
            await tx.award.update({
              where: { id: award.id },
              data: {
                status: 'CANCELLED',
                cancellationReason: 'ITEM_DELETED',
                cancelledAt: new Date(),
              },
            });
            this.logger.log(`取消 Award（商品被删除）: ${award.id}`);
          } else {
            // 如果还有其他商品，需要重新计算 finalPrice
            const remainingQuoteItems = await tx.quoteItem.findMany({
              where: {
                quoteId: award.quoteId,
                rfqItemId: { not: itemId },
              },
              include: {
                rfqItem: true,
              },
            });

            let newFinalPrice = 0;
            for (const qi of remainingQuoteItems) {
              const quantity = qi.rfqItem?.quantity || 1;
              newFinalPrice += parseFloat(qi.price.toString()) * quantity;
            }

            await tx.award.update({
              where: { id: award.id },
              data: {
                finalPrice: newFinalPrice,
                reason: award.reason ? `${award.reason}（已移除商品：${rfqItem.productName}）` : `已移除商品：${rfqItem.productName}`,
              },
            });
            this.logger.log(`更新 Award finalPrice（商品被删除）: ${award.id}, 新价格: ${newFinalPrice}`);
          }
        }
      }

      // 4. 更新相关的 Quote 记录（重新计算 price 和 status）
      const quotesWithThisItem = await tx.quote.findMany({
        where: {
          rfqId: rfqItem.rfqId,
        },
        include: {
          items: {
            where: {
              rfqItemId: { not: itemId },
            },
            include: {
              rfqItem: true,
            },
          },
        },
      });

      for (const quote of quotesWithThisItem) {
        // 重新计算 quote 的 price
        let newPrice = 0;
        for (const qi of quote.items) {
          const quantity = qi.rfqItem?.quantity || 1;
          newPrice += parseFloat(qi.price.toString()) * quantity;
        }

        // 如果 quote 中没有任何商品了，删除该 quote
        if (quote.items.length === 0) {
          await tx.quote.delete({
            where: { id: quote.id },
          });
          this.logger.log(`删除空的 Quote: ${quote.id}`);
        } else {
          // 更新 quote 的 price
          await tx.quote.update({
            where: { id: quote.id },
            data: {
              price: newPrice,
            },
          });
          this.logger.log(`更新 Quote price（商品被删除）: ${quote.id}, 新价格: ${newPrice}`);
        }
      }

      // 5. 删除商品本身
      await tx.rfqItem.delete({
        where: { id: itemId },
      });
    });

    // 记录审计日志
    await this.auditService.log({
      action: 'rfq.item.delete',
      resource: 'RfqItem',
      resourceId: itemId,
      userId,
      details: {
        productName: rfqItem.productName,
        rfqId: rfqItem.rfqId,
        rfqNo: rfqItem.rfq.rfqNo,
      },
    });

    this.logger.log(`询价单商品已删除: ${rfqItem.productName} (${itemId})`);
    return { success: true, message: '商品已删除' };
  }

  /**
   * 根据商品名称查询最近5天内的相同商品的历史价格（不限制门店）
   * @param productName 商品名称
   * @returns 历史价格记录数组
   */
  async getHistoricalPrices(productName: string): Promise<Array<{
    maxPrice: number | null;
    instantPrice: number | null;
    rfqNo: string;
    rfqTitle: string;
    createdAt: Date;
    storeName?: string;
  }>> {
    if (!productName || productName.trim() === '') {
      return [];
    }

    // 计算5天前的日期
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

    // 查询条件：商品名称相同（忽略大小写和空格），创建时间在5天内
    // 注意：我们也查询草稿状态的询价单，因为用户可能在设置价格时想参考之前草稿中的价格
    // 不限制门店，查询所有门店的历史记录
    const rfqWhere: Prisma.RfqWhereInput = {};

    // 使用精确匹配或包含匹配（先尝试精确匹配，如果没结果再尝试包含匹配）
    // 注意：只查询已设置最高限价的商品，因为只有设置了最高限价的商品才有参考价值
    const trimmedProductName = productName.trim();
    
    // 先尝试精确匹配（去除首尾空格后）
    let whereCondition: Prisma.RfqItemWhereInput = {
      productName: {
        equals: trimmedProductName,
      },
      createdAt: {
        gte: fiveDaysAgo,
      },
      maxPrice: {
        not: null, // 只查询已设置最高限价的商品
      },
      rfq: rfqWhere,
    };

    // 添加调试日志
    this.logger.debug('查询历史价格', {
      productName: productName.trim(),
      fiveDaysAgo: fiveDaysAgo.toISOString(),
      whereCondition: JSON.stringify(whereCondition),
    });

    // 查询历史记录
    const historicalItems = await this.prisma.rfqItem.findMany({
      where: whereCondition,
      include: {
        rfq: {
          include: {
            store: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: 'desc', // 按创建时间倒序，最新的在前
      },
      take: 10, // 最多返回10条记录
    });

    // 添加调试日志
    this.logger.debug('历史价格查询结果', {
      productName: productName.trim(),
      foundCount: historicalItems.length,
      items: historicalItems.map(item => ({
        id: item.id,
        productName: item.productName,
        maxPrice: item.maxPrice,
        instantPrice: item.instantPrice,
        rfqNo: item.rfq.rfqNo,
        rfqStatus: item.rfq.status,
        createdAt: item.createdAt,
      })),
    });

    // 转换为返回格式
    return historicalItems.map(item => ({
      maxPrice: item.maxPrice ? Number(item.maxPrice) : null,
      instantPrice: item.instantPrice ? Number(item.instantPrice) : null,
      rfqNo: item.rfq.rfqNo,
      rfqTitle: item.rfq.title,
      createdAt: item.createdAt,
      storeName: item.rfq.store?.name,
    }));
  }
}

