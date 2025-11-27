import { Injectable, BadRequestException, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';
import { QuoteStatus } from '@prisma/client';

@Injectable()
export class QuoteService {
  private readonly logger = new Logger(QuoteService.name);

  constructor(
    private prisma: PrismaService,
    private auditService: AuditService,
    private notificationService: NotificationService,
  ) {}

  async create(createQuoteDto: CreateQuoteDto, supplierId: string) {
    try {
      // 验证必填字段
      if (!createQuoteDto.rfqId || createQuoteDto.rfqId.trim() === '') {
        throw new BadRequestException('询价单ID不能为空');
      }
      if (!supplierId || supplierId.trim() === '') {
        throw new BadRequestException('供应商ID不能为空');
      }

      // 检查 RFQ 是否已关闭
      const rfq = await this.prisma.rfq.findUnique({
        where: { id: createQuoteDto.rfqId },
        include: { items: true },
      });

      if (!rfq) {
        throw new NotFoundException(`询价单不存在：${createQuoteDto.rfqId}`);
      }

      if (rfq.status === 'CLOSED' || rfq.status === 'AWARDED') {
        throw new BadRequestException(`询价单已关闭或已中标，无法提交报价。当前状态：${rfq.status}`);
      }

    // 如果提供了商品级别的报价，验证所有报价的商品都属于该 RFQ
    if (createQuoteDto.items && createQuoteDto.items.length > 0) {
      const rfqItemIds = rfq.items.map(item => item.id);
      const quoteItemIds = createQuoteDto.items.map(item => item.rfqItemId);
      const invalidItems = quoteItemIds.filter(id => !rfqItemIds.includes(id));
      
      if (invalidItems.length > 0) {
        throw new BadRequestException(`Invalid items: some quote items do not belong to this RFQ`);
      }
      
      // 验证所有报价商品都有价格
      const itemsWithoutPrice = createQuoteDto.items.filter(item => !item.price || item.price <= 0);
      if (itemsWithoutPrice.length > 0) {
        throw new BadRequestException(`All quoted items must have a valid price`);
      }
      
      // 验证报价不能超过最高限价
      for (const quoteItem of createQuoteDto.items) {
        const rfqItem = rfq.items.find(item => item.id === quoteItem.rfqItemId);
        if (rfqItem && rfqItem.maxPrice) {
          const maxPrice = Number(rfqItem.maxPrice);
          if (quoteItem.price > maxPrice) {
            throw new BadRequestException(
              `商品 "${rfqItem.productName}" 的报价 ${quoteItem.price} 超过了最高限价 ${maxPrice}`
            );
          }
        }
      }
      
      this.logger.log('创建报价', {
        rfqId: createQuoteDto.rfqId,
        supplierId,
        itemsCount: createQuoteDto.items.length,
        totalRfqItems: rfq.items.length,
      });
    }

    // 检查是否已报价
    const existingQuote = await this.prisma.quote.findUnique({
      where: {
        rfqId_supplierId: {
          rfqId: createQuoteDto.rfqId,
          supplierId,
        },
      },
      include: { items: true },
    });

    if (existingQuote) {
      // 更新报价（增量更新：保留已有商品，只更新/添加新提交的商品）
      const quote = await this.prisma.quote.update({
        where: { id: existingQuote.id },
        data: {
          price: createQuoteDto.price,
          deliveryDays: createQuoteDto.deliveryDays,
          notes: createQuoteDto.notes,
          status: 'SUBMITTED',
        },
      });

      // 增量更新商品报价：更新已存在的，添加新的，保留未提交的
      if (createQuoteDto.items && createQuoteDto.items.length > 0) {
        const existingItemIds = existingQuote.items.map(item => item.rfqItemId);
        const newItemIds = createQuoteDto.items.map(item => item.rfqItemId);
        
        // 找出需要更新的商品（已存在）
        const itemsToUpdate = createQuoteDto.items.filter(item => 
          existingItemIds.includes(item.rfqItemId)
        );
        
        // 找出需要新增的商品（不存在）
        const itemsToCreate = createQuoteDto.items.filter(item => 
          !existingItemIds.includes(item.rfqItemId)
        );
        
        // 找出需要删除的商品（已存在但新提交中没有，可选：如果不想删除，可以注释掉这部分）
        // const itemsToDelete = existingQuote.items.filter(item => 
        //   !newItemIds.includes(item.rfqItemId)
        // );
        
        // 更新已存在的商品报价
        for (const item of itemsToUpdate) {
          await this.prisma.quoteItem.updateMany({
            where: {
              quoteId: quote.id,
              rfqItemId: item.rfqItemId,
            },
            data: {
              price: item.price,
              deliveryDays: item.deliveryDays || 0,
              notes: item.notes,
            },
          });
        }
        
        // 添加新的商品报价
        if (itemsToCreate.length > 0) {
          await this.prisma.quoteItem.createMany({
            data: itemsToCreate.map(item => ({
              quoteId: quote.id,
              rfqItemId: item.rfqItemId,
              price: item.price,
              deliveryDays: item.deliveryDays || 0,
              notes: item.notes,
            })),
          });
        }
        
        // 可选：删除未提交的商品报价（如果供应商想移除某些商品的报价）
        // if (itemsToDelete.length > 0) {
        //   await this.prisma.quoteItem.deleteMany({
        //     where: {
        //       quoteId: quote.id,
        //       rfqItemId: { in: itemsToDelete.map(item => item.rfqItemId) },
        //     },
        //   });
        // }
      }

      // 记录审计日志（失败不影响主流程）
      try {
        await this.auditService.log({
          action: 'quote.update',
          resource: 'Quote',
          resourceId: quote.id,
          userId: supplierId,
        });
      } catch (auditError) {
        const errorMessage = auditError instanceof Error ? auditError.message : String(auditError);
        this.logger.warn('记录审计日志失败', {
          quoteId: quote.id,
          supplierId,
          error: errorMessage,
        });
      }

      const updatedQuote = await this.prisma.quote.findUnique({
        where: { id: quote.id },
        include: {
          items: {
            include: {
              rfqItem: true,
            },
          },
          rfq: {
            include: {
              store: true,
              buyer: {
                select: {
                  id: true,
                  username: true,
                },
              },
            },
          },
        },
      });

      // 发送通知：通知门店用户、采购员和管理员报价已更新
      try {
        if (updatedQuote?.rfq && updatedQuote.rfq) {
          const supplier = await this.prisma.user.findUnique({
            where: { id: supplierId },
            select: {
              id: true,
              username: true,
            },
          });

          if (supplier) {
            const itemCount = createQuoteDto.items?.length || 0;
            const totalPrice = createQuoteDto.price;
            const itemNames = updatedQuote.items?.map(item => item.rfqItem?.productName).filter(Boolean).join('、') || '商品';

            // 通知门店用户（如果询价单关联了门店）
            if (updatedQuote.rfq.storeId) {
              const storeUsers = await this.prisma.user.findMany({
                where: {
                  role: 'STORE',
                  storeId: updatedQuote.rfq.storeId,
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
                  type: 'QUOTE_SUBMITTED',
                  title: '报价已更新',
                  content: `供应商 ${supplier.username} 更新了询价单 ${updatedQuote.rfq.rfqNo} 的报价，包含 ${itemCount} 个商品：${itemNames}，总价 ¥${Number(totalPrice).toFixed(2)}`,
                  link: `/rfqs/${createQuoteDto.rfqId}`,
                  userName: storeUser.username || undefined,
                });
              }
            }

            // 通知采购员
            if (updatedQuote.rfq.buyerId) {
              await this.notificationService.create({
                userId: updatedQuote.rfq.buyerId,
                type: 'QUOTE_SUBMITTED',
                title: '报价已更新',
                content: `供应商 ${supplier.username} 更新了询价单 ${updatedQuote.rfq.rfqNo} 的报价，包含 ${itemCount} 个商品：${itemNames}，总价 ¥${Number(totalPrice).toFixed(2)}`,
                link: `/rfqs/${createQuoteDto.rfqId}`,
                userName: updatedQuote.rfq.buyer?.username || undefined,
              });
            }

            // 通知所有管理员
            const admins = await this.prisma.user.findMany({
              where: {
                role: 'ADMIN',
                status: 'ACTIVE',
              },
              select: {
                id: true,
                username: true,
              },
            });

            for (const admin of admins) {
              await this.notificationService.create({
                userId: admin.id,
                type: 'QUOTE_SUBMITTED',
                title: '报价已更新',
                content: `供应商 ${supplier.username} 更新了询价单 ${updatedQuote.rfq.rfqNo} 的报价，包含 ${itemCount} 个商品：${itemNames}，总价 ¥${Number(totalPrice).toFixed(2)}`,
                link: `/rfqs/${createQuoteDto.rfqId}`,
                userName: admin.username || undefined,
              });
            }
          }
        }
      } catch (notifyError) {
        const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
        this.logger.warn('发送报价更新通知失败（不影响报价更新）', {
          quoteId: quote.id,
          rfqId: createQuoteDto.rfqId,
          supplierId,
          error: errorMessage,
        });
      }

      // 检查一口价自动中标逻辑（更新报价的情况）
      if (createQuoteDto.items && createQuoteDto.items.length > 0 && updatedQuote) {
        await this.checkInstantPriceAward(quote.id, updatedQuote.rfqId, createQuoteDto.items);
      }

      return updatedQuote;
    }

    // 创建新报价
    const quote = await this.prisma.quote.create({
      data: {
        rfqId: createQuoteDto.rfqId,
        supplierId,
        price: createQuoteDto.price,
        deliveryDays: createQuoteDto.deliveryDays || 0,
        notes: createQuoteDto.notes,
        status: 'SUBMITTED',
        items: createQuoteDto.items && createQuoteDto.items.length > 0 ? {
          create: createQuoteDto.items.map(item => ({
            rfqItemId: item.rfqItemId,
            price: item.price,
            deliveryDays: item.deliveryDays || 0,
            notes: item.notes,
          })),
        } : undefined,
      },
      include: {
        items: {
          include: {
            rfqItem: true,
          },
        },
      },
    });

    // 记录审计日志（失败不影响主流程）
    try {
      await this.auditService.log({
        action: 'quote.submit',
        resource: 'Quote',
        resourceId: quote.id,
        userId: supplierId,
      });
    } catch (auditError) {
      const errorMessage = auditError instanceof Error ? auditError.message : String(auditError);
      this.logger.warn('记录审计日志失败', {
        quoteId: quote.id,
        supplierId,
        error: errorMessage,
      });
    }

    this.logger.log('报价创建成功', {
      quoteId: quote.id,
      rfqId: createQuoteDto.rfqId,
      supplierId,
      itemsCount: createQuoteDto.items?.length || 0,
    });

    // 发送通知：通知门店用户、采购员和管理员有新报价
    try {
      // 获取询价单信息（包含门店和采购员信息）
      const rfqWithDetails = await this.prisma.rfq.findUnique({
        where: { id: createQuoteDto.rfqId },
        include: {
          store: true,
          buyer: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      // 获取供应商信息
      const supplier = await this.prisma.user.findUnique({
        where: { id: supplierId },
        select: {
          id: true,
          username: true,
        },
      });

      if (rfqWithDetails && supplier) {
        const itemCount = createQuoteDto.items?.length || 0;
        const totalPrice = createQuoteDto.price;
        const itemNames = quote.items?.map(item => item.rfqItem?.productName).filter(Boolean).join('、') || '商品';

        // 通知门店用户（如果询价单关联了门店）
        if (rfqWithDetails.storeId) {
          const storeUsers = await this.prisma.user.findMany({
            where: {
              role: 'STORE',
              storeId: rfqWithDetails.storeId,
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
              type: 'QUOTE_SUBMITTED',
              title: '收到新报价',
              content: `供应商 ${supplier.username} 为询价单 ${rfqWithDetails.rfqNo} 提交了报价，包含 ${itemCount} 个商品：${itemNames}，总价 ¥${Number(totalPrice).toFixed(2)}`,
              link: `/rfqs/${createQuoteDto.rfqId}`,
              userName: storeUser.username || undefined,
            });
          }

          this.logger.log('已通知门店用户有新报价', {
            rfqId: createQuoteDto.rfqId,
            storeId: rfqWithDetails.storeId,
            storeUsersCount: storeUsers.length,
          });
        }

        // 通知采购员（询价单创建者）
        if (rfqWithDetails.buyerId) {
          await this.notificationService.create({
            userId: rfqWithDetails.buyerId,
            type: 'QUOTE_SUBMITTED',
            title: '收到新报价',
            content: `供应商 ${supplier.username} 为询价单 ${rfqWithDetails.rfqNo} 提交了报价，包含 ${itemCount} 个商品：${itemNames}，总价 ¥${Number(totalPrice).toFixed(2)}`,
            link: `/rfqs/${createQuoteDto.rfqId}`,
            userName: rfqWithDetails.buyer?.username || undefined,
          });
        }

        // 通知所有管理员
        const admins = await this.prisma.user.findMany({
          where: {
            role: 'ADMIN',
            status: 'ACTIVE',
          },
          select: {
            id: true,
            username: true,
          },
        });

        for (const admin of admins) {
          await this.notificationService.create({
            userId: admin.id,
            type: 'QUOTE_SUBMITTED',
            title: '收到新报价',
            content: `供应商 ${supplier.username} 为询价单 ${rfqWithDetails.rfqNo} 提交了报价，包含 ${itemCount} 个商品：${itemNames}，总价 ¥${Number(totalPrice).toFixed(2)}`,
            link: `/rfqs/${createQuoteDto.rfqId}`,
            userName: admin.username || undefined,
          });
        }

        this.logger.log('已发送报价通知', {
          rfqId: createQuoteDto.rfqId,
          supplierId,
          notifiedUsers: {
            storeUsers: rfqWithDetails.storeId ? '已通知' : '无门店',
            buyer: rfqWithDetails.buyerId ? '已通知' : '无采购员',
            admins: admins.length,
          },
        });
      }
    } catch (notifyError) {
      const errorMessage = notifyError instanceof Error ? notifyError.message : String(notifyError);
      this.logger.warn('发送报价通知失败（不影响报价创建）', {
        rfqId: createQuoteDto.rfqId,
        supplierId,
        error: errorMessage,
      });
      // 通知失败不影响报价创建，继续执行
    }

    // 检查一口价自动中标逻辑（新建报价的情况）
    if (createQuoteDto.items && createQuoteDto.items.length > 0) {
      await this.checkInstantPriceAward(quote.id, createQuoteDto.rfqId, createQuoteDto.items);
    }

    return quote;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('创建报价失败', {
        rfqId: createQuoteDto.rfqId,
        supplierId,
        itemsCount: createQuoteDto.items?.length || 0,
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
        throw new BadRequestException('创建报价失败：该询价单已有报价，请更新现有报价');
      }
      if (errorMessage.includes('Foreign key') || errorMessage.includes('外键')) {
        throw new BadRequestException('创建报价失败：关联数据不存在，请检查询价单和商品信息');
      }

      throw new BadRequestException(`创建报价失败：${errorMessage}`);
    }
  }

  async findAll(filters?: {
    rfqId?: string;
    supplierId?: string;
    status?: string;
    storeId?: string; // 门店ID，用于过滤询价单
  }) {
    try {
      // 如果同时指定了 rfqId 和 storeId，先验证询价单是否属于该门店
      if (filters?.rfqId && filters?.storeId) {
        const rfq = await this.prisma.rfq.findUnique({
          where: { id: filters.rfqId },
          select: { storeId: true },
        });
        
        // 如果询价单不存在或不属于该门店，返回空数组
        if (!rfq || rfq.storeId !== filters.storeId) {
          this.logger.warn('门店用户查询报价：询价单不属于该门店', {
            rfqId: filters.rfqId,
            storeId: filters.storeId,
            rfqStoreId: rfq?.storeId,
          });
          return [];
        }
      }
      
      // 构建查询条件
      const where: any = {
          rfqId: filters?.rfqId,
          supplierId: filters?.supplierId,
          status: filters?.status ? (filters.status as QuoteStatus) : undefined,
        };
      
      // 如果只指定了门店ID（没有指定 rfqId），需要通过询价单关联过滤
      if (filters?.storeId && !filters?.rfqId) {
        where.rfq = {
          storeId: filters.storeId,
        };
      }
      
      return await this.prisma.quote.findMany({
        where,
      include: {
        rfq: {
          include: {
            store: true,
            items: true,
          },
        },
        supplier: {
          select: {
            id: true,
            username: true,
            email: true,
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('查询报价列表失败', {
        filters,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('查询报价列表失败，请稍后重试');
    }
  }

  async findOne(id: string) {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('报价ID不能为空');
      }

      const quote = await this.prisma.quote.findUnique({
        where: { id },
        include: {
          rfq: {
            include: {
              items: true,
            },
          },
          supplier: true,
          items: {
            include: {
              rfqItem: true,
            },
          },
        },
      });

      if (!quote) {
        throw new NotFoundException(`报价不存在：${id}`);
      }

      return quote;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('查询报价详情失败', {
        id,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('查询报价详情失败，请稍后重试');
    }
  }

  async awardQuote(rfqId: string, quoteId: string, reason?: string) {
    try {
      // 验证参数
      if (!rfqId || rfqId.trim() === '') {
        throw new BadRequestException('询价单ID不能为空');
      }
      if (!quoteId || quoteId.trim() === '') {
        throw new BadRequestException('报价ID不能为空');
      }

      const quote = await this.prisma.quote.findUnique({
        where: { id: quoteId },
        include: { rfq: true },
      });

      if (!quote) {
        throw new NotFoundException(`报价不存在：${quoteId}`);
      }

      if (quote.rfqId !== rfqId) {
        throw new BadRequestException(`报价不属于此询价单。报价的询价单ID：${quote.rfqId}，请求的询价单ID：${rfqId}`);
      }

      // 验证询价单状态
      if (quote.rfq.status !== 'CLOSED') {
        throw new BadRequestException(`询价单未截标，无法选商。当前状态：${quote.rfq.status}`);
      }

      // 创建选商结果
      const award = await this.prisma.award.create({
        data: {
          rfqId,
          quoteId,
          supplierId: quote.supplierId,
          finalPrice: quote.price,
          reason,
        },
      });

      // 更新 RFQ 状态
      await this.prisma.rfq.update({
        where: { id: rfqId },
        data: {
          status: 'AWARDED',
        },
      });

      // 更新报价状态
      await this.prisma.quote.update({
        where: { id: quoteId },
        data: {
          status: 'AWARDED',
        },
      });

      // 更新其他报价为拒绝
      await this.prisma.quote.updateMany({
        where: {
          rfqId,
          id: { not: quoteId },
        },
        data: {
          status: 'REJECTED',
        },
      });

      this.logger.log('报价中标成功', {
        rfqId,
        quoteId,
        supplierId: quote.supplierId,
        finalPrice: quote.price,
      });

      return award;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      this.logger.error('选商失败', {
        rfqId,
        quoteId,
        reason,
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
        throw new BadRequestException('选商失败：该询价单已有中标记录');
      }
      if (errorMessage.includes('Foreign key') || errorMessage.includes('外键')) {
        throw new BadRequestException('选商失败：关联数据不存在，请检查询价单和报价信息');
      }

      throw new BadRequestException(`选商失败：${errorMessage}`);
    }
  }

  /**
   * 检查一口价自动中标逻辑
   * 如果报价的商品中，有报价<=一口价的，自动中标该商品
   */
  private async checkInstantPriceAward(
    quoteId: string,
    rfqId: string,
    quoteItems: Array<{ rfqItemId: string; price: number }>,
  ) {
    try {
      // 重新获取报价和询价单信息，包含一口价字段
      const quote = await this.prisma.quote.findUnique({
        where: { id: quoteId },
        include: {
          items: {
            include: {
              rfqItem: true,
            },
          },
          rfq: true,
        },
      });

      if (!quote || !quote.rfq) {
        return;
      }

      // 询价单必须是已发布状态才能自动中标
      if (quote.rfq.status !== 'PUBLISHED') {
        return;
      }

      const rfqStatus = quote.rfq.status; // 保存状态，避免类型推断问题

      // 检查每个报价商品是否满足一口价条件
      const instantAwardItems: Array<{ rfqItemId: string; quoteItemId: string }> = [];

      for (const quoteItem of quote.items) {
        const rfqItem = quoteItem.rfqItem;
        
        // 如果商品已中标，跳过
        if (rfqItem.itemStatus === 'AWARDED' || rfqItem.itemStatus === 'CANCELLED' || rfqItem.itemStatus === 'OUT_OF_STOCK') {
          continue;
        }

        // 检查是否设置了一口价
        if (rfqItem.instantPrice) {
          const instantPrice = Number(rfqItem.instantPrice);
          const quotePrice = Number(quoteItem.price);

          // 如果报价<=一口价，自动中标
          if (quotePrice <= instantPrice) {
            instantAwardItems.push({
              rfqItemId: rfqItem.id,
              quoteItemId: quoteItem.id,
            });
          }
        }
      }

      // 如果有满足一口价条件的商品，自动中标
      if (instantAwardItems.length > 0) {
        this.logger.log('检测到一口价自动中标', {
          rfqId,
          quoteId,
          instantAwardItemsCount: instantAwardItems.length,
          items: instantAwardItems.map(item => ({
            rfqItemId: item.rfqItemId,
            quoteItemId: item.quoteItemId,
          })),
        });

        // 为每个满足条件的商品执行自动中标
        for (const item of instantAwardItems) {
          try {
            // 更新商品状态为已中标
            await this.prisma.rfqItem.update({
              where: { id: item.rfqItemId },
              data: {
                itemStatus: 'AWARDED',
              },
            });

            // 获取报价项信息
            const quoteItem = await this.prisma.quoteItem.findUnique({
              where: { id: item.quoteItemId },
              include: {
                quote: true,
                rfqItem: true,
              },
            });

            if (quoteItem) {
              // 创建或更新Award记录
              const supplierId = quoteItem.quote.supplierId;
              const existingAward = await this.prisma.award.findUnique({
                where: {
                  rfqId_supplierId: {
                    rfqId,
                    supplierId,
                  },
                },
              });

              if (existingAward) {
                // 更新现有Award记录的总价
                // 需要查询该供应商在该询价单中所有已中标的商品，并计算总价（单价 × 数量）
                const allAwardedItems = await this.prisma.quoteItem.findMany({
                  where: {
                    quote: {
                      rfqId,
                      supplierId,
                    },
                    rfqItem: {
                      itemStatus: 'AWARDED',
                    },
                  },
                  include: {
                    rfqItem: {
                      select: {
                        id: true,
                        quantity: true,
                      },
                    },
                  },
                });

                // 计算总价：单价 × 数量
                const totalPrice = allAwardedItems.reduce((sum, item) => {
                  const price = Number(item.price);
                  const quantity = item.rfqItem.quantity || 1;
                  return sum + price * quantity;
                }, 0);

                await this.prisma.award.update({
                  where: { id: existingAward.id },
                  data: {
                    finalPrice: totalPrice,
                    reason: existingAward.reason 
                      ? `${existingAward.reason}；一口价自动中标：${quoteItem.rfqItem.productName}`
                      : `一口价自动中标：${quoteItem.rfqItem.productName}`,
                  },
                });
              } else {
                // 创建新的Award记录
                // 计算总价：单价 × 数量
                const quantity = quoteItem.rfqItem.quantity || 1;
                const totalPrice = Number(quoteItem.price) * quantity;
                
                await this.prisma.award.create({
                  data: {
                    rfqId,
                    quoteId: quoteItem.quoteId,
                    supplierId,
                    finalPrice: totalPrice,
                    reason: `一口价自动中标：${quoteItem.rfqItem.productName}（报价¥${quoteItem.price} <= 一口价¥${quoteItem.rfqItem.instantPrice}）`,
                  },
                });
              }

              // 更新报价状态为AWARDED
              await this.prisma.quote.update({
                where: { id: quoteItem.quoteId },
                data: { status: 'AWARDED' },
              });

              this.logger.log('一口价自动中标成功', {
                rfqId,
                quoteId: quoteItem.quoteId,
                rfqItemId: item.rfqItemId,
                quoteItemId: item.quoteItemId,
                productName: quoteItem.rfqItem.productName,
                quotePrice: quoteItem.price,
                instantPrice: quoteItem.rfqItem.instantPrice,
              });
            }
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('一口价自动中标失败', {
              rfqId,
              quoteId,
              rfqItemId: item.rfqItemId,
              quoteItemId: item.quoteItemId,
              error: errorMessage,
            });
          }
        }

        // 检查询价单是否所有商品都已中标
        const allRfqItems = await this.prisma.rfqItem.findMany({
          where: { rfqId },
        });

        const allAwarded = allRfqItems.every(
          item => item.itemStatus === 'AWARDED' || 
                  item.itemStatus === 'CANCELLED' || 
                  item.itemStatus === 'OUT_OF_STOCK'
        );

        // 重新获取询价单状态，检查是否需要更新
        const updatedRfq = await this.prisma.rfq.findUnique({
          where: { id: rfqId },
          select: { status: true },
        });

        if (allAwarded && updatedRfq && updatedRfq.status !== 'AWARDED') {
          await this.prisma.rfq.update({
            where: { id: rfqId },
            data: { status: 'AWARDED' },
          });
          this.logger.log('询价单所有商品已中标（一口价），状态已更新为 AWARDED', { rfqId });
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('检查一口价自动中标失败', {
        quoteId,
        rfqId,
        error: errorMessage,
      });
      // 不抛出错误，避免影响报价创建的主流程
    }
  }
}

