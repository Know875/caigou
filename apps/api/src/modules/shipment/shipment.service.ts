import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { StorageService } from '../storage/storage.service';
import { OcrService } from '../ocr/ocr.service';
import { AuditService } from '../audit/audit.service';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class ShipmentService {
  private readonly logger = new Logger(ShipmentService.name);

  constructor(
    private prisma: PrismaService,
    private storageService: StorageService,
    private ocrService: OcrService,
    private auditService: AuditService,
    private notificationService: NotificationService,
  ) {}

  async create(createShipmentDto: CreateShipmentDto, supplierId: string) {
    const shipment = await this.prisma.shipment.create({
      data: {
        ...createShipmentDto,
        shipmentNo: `SHIP-${Date.now()}`,
        supplierId: supplierId || undefined,
        source: 'SUPPLIER',
        trackingNo: createShipmentDto.trackingNo || `TEMP-${Date.now()}`,
      },
      include: {
        order: true,
        award: true,
      },
    });

    // 审计日志：创建发货单
    await this.auditService.log({
      action: 'shipment.create',
      resource: 'Shipment',
      resourceId: shipment.id,
      userId: supplierId,
      details: {
        shipmentNo: shipment.shipmentNo,
        trackingNo: shipment.trackingNo,
        carrier: shipment.carrier,
        source: shipment.source,
      },
    });

    return shipment;
  }

  async uploadLabel(shipmentId: string, file: Express.Multer.File, supplierId?: string) {
    // 验证文件是否存在
    if (!file) {
      throw new BadRequestException('请选择要上传的文件');
    }

    // 验证文件类型（只允许图片）
    const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
    if (!allowedImageTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        `不支持的文件类型: ${file.mimetype}。仅支持图片格式: ${allowedImageTypes.join(', ')}`,
      );
    }

    // 验证文件大小（最大 10MB）
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      throw new BadRequestException(`文件大小超过限制（最大 ${maxSize / 1024 / 1024}MB）`);
    }

    // 校验权限：如果是供应商，只能上传自己的发货单
    // 同时取出 rfqItemId，方便后面同步更新 RfqItem
    const shipmentForAuth = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        supplierId: true,
        rfqItemId: true,
      },
    });

    if (!shipmentForAuth) {
      throw new NotFoundException('发货单不存在');
    }

    if (supplierId && shipmentForAuth.supplierId !== supplierId) {
      throw new BadRequestException('无权上传此发货单的面单');
    }

    // 上传到 MinIO
    let fileUrl: string;
    try {
      fileUrl = await this.storageService.uploadFile(file, 'shipment-labels');
    } catch (error: any) {
      this.logger.error('文件上传失败', { error: error.message || error });
      throw new BadRequestException(`文件上传失败: ${error.message || '未知错误'}`);
    }

    // 从 URL 提取文件 key（用于存储到数据库，避免 URL 过长）
    let fileKey: string;
    try {
      const url = new URL(fileUrl);
      let keyFromUrl = url.pathname.substring(1); // 移除前导斜杠
      // 移除 bucket 名称前缀
      if (keyFromUrl.startsWith('eggpurchase/')) {
        keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
      }
      fileKey = keyFromUrl;
    } catch {
      // 如果无法解析 URL，使用完整 URL 作为 key（向后兼容）
      fileKey = fileUrl;
    }

    // OCR 识别
    let ocrResult;
    try {
      ocrResult = await this.ocrService.extractTrackingNumber(file.buffer);
    } catch (error: any) {
      this.logger.warn('OCR 识别失败，但继续保存文件', { error: error.message || error });
      // OCR 失败不应该阻止整个流程，使用空结果
      ocrResult = {
        trackingNo: null,
        carrier: null,
        confidence: 0,
        method: 'none',
      };
    }

    // 创建 OCR 记录（存储文件 key 而不是完整 URL）
    const trackingExtract = await this.prisma.trackingExtract.create({
      data: {
        shipmentId,
        imageUrl: fileKey, // 存储文件 key，而不是完整的签名 URL
        trackingNo: ocrResult.trackingNo,
        carrier: ocrResult.carrier,
        confidence: ocrResult.confidence,
        method: ocrResult.method,
        rawText: ocrResult.rawText,
        autoFilled: ocrResult.confidence >= 0.85,
      },
    });

    // 创建或更新包裹记录，保存快递面单 URL（门店可以查看）
    let packageRecord = await this.prisma.package.findFirst({
      where: {
        shipmentId: shipmentId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!packageRecord) {
      // 如果没有包裹记录，创建一个新的
      packageRecord = await this.prisma.package.create({
        data: {
          shipmentId: shipmentId,
          packageNo: `PKG-${Date.now()}`,
          labelUrl: fileKey, // 存储文件 key，而不是完整的签名 URL
        },
      });
    } else {
      // 更新现有包裹记录的面单 URL
      packageRecord = await this.prisma.package.update({
        where: { id: packageRecord.id },
        data: {
          labelUrl: fileKey, // 存储文件 key，而不是完整的签名 URL
        },
      });
    }

    // 置信度 >= 0.85 时尝试自动回填运单号
    if (ocrResult.confidence >= 0.85 && ocrResult.trackingNo) {
      try {
        // 拿到当前发货单的完整信息（包括 supplierId / rfqItemId / awardId）
        const currentShipment = await this.prisma.shipment.findUnique({
          where: { id: shipmentId },
          select: {
            id: true,
            supplierId: true,
            rfqItemId: true,
            awardId: true,
          },
        });

        if (!currentShipment) {
          console.warn(
            `[ShipmentService] shipment ${shipmentId} not found when autofilling tracking number`,
          );
          return {
            trackingExtract,
            autoFilled: false,
          };
        }

        // 检查该运单号是否已经被其它发货单使用
        const existingShipments = await this.prisma.shipment.findMany({
          where: {
            trackingNo: ocrResult.trackingNo,
            id: { not: shipmentId },
          },
          select: {
            id: true,
            supplierId: true,
            rfqItemId: true,
            awardId: true,
          },
        });

        if (existingShipments.length > 0) {
          // 先计算当前发货单对应的 RFQ ID（通过 awardId 或 rfqItemId）
          let currentRfqId: string | null = null;
          if (currentShipment.awardId) {
            const award = await this.prisma.award.findUnique({
              where: { id: currentShipment.awardId },
              select: { rfqId: true },
            });
            currentRfqId = award?.rfqId || null;
          } else if (currentShipment.rfqItemId) {
            const rfqItem = await this.prisma.rfqItem.findUnique({
              where: { id: currentShipment.rfqItemId },
              select: { rfqId: true },
            });
            currentRfqId = rfqItem?.rfqId || null;
          }

          // 判断是否存在同一供应商 + 同一 RFQ 的其它发货单
          let canShare = false;
          for (const existing of existingShipments) {
            if (existing.supplierId !== currentShipment.supplierId) {
              continue; // 不同供应商，不能共用
            }

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

            if (existingRfqId && existingRfqId === currentRfqId) {
              canShare = true;
              break;
            }
          }

          // 如果不能共用，则认为该运单号已经被其他场景占用，取消自动回填
          if (!canShare) {
            console.warn(
              `[ShipmentService] trackingNo ${ocrResult.trackingNo} already used by other shipments with different supplier/RFQ, skip autofill`,
            );
            await this.prisma.trackingExtract.update({
              where: { id: trackingExtract.id },
              data: {
                autoFilled: false,
              },
            });
            return {
              trackingExtract,
              autoFilled: false,
            };
          }
        }

        // 可以共用运单号，更新当前发货单
        // 更新运单号时，同时更新状态为已发货
        await this.prisma.shipment.update({
          where: { id: shipmentId },
          data: {
            trackingNo: ocrResult.trackingNo,
            carrier: ocrResult.carrier,
            status: 'SHIPPED' as any,
            shippedAt: new Date(),
          },
        });

        // 同步更新 RfqItem，使“发货管理”和“报价管理”看到同一个运单号
        if (shipmentForAuth?.rfqItemId) {
          await this.prisma.rfqItem.update({
            where: { id: shipmentForAuth.rfqItemId },
            data: {
              trackingNo: ocrResult.trackingNo,
              carrier: ocrResult.carrier || null,
              shipmentId: shipmentId,
              source: 'SUPPLIER',
            },
          });
        }

        await this.prisma.trackingExtract.update({
          where: { id: trackingExtract.id },
          data: {
            autoFilled: true,
            confirmedAt: new Date(),
          },
        });

        // 审计日志：OCR 自动回填
        await this.auditService.log({
          action: 'ocr.autofill',
          resource: 'Shipment',
          resourceId: shipmentId,
          details: {
            trackingNo: ocrResult.trackingNo,
            carrier: ocrResult.carrier,
            confidence: ocrResult.confidence,
            method: ocrResult.method,
          },
        });

        // OCR 成功后，给相关用户发送通知（使用最终确认后的运单号）
        if (shipmentForAuth?.rfqItemId) {
          const rfqItem = await this.prisma.rfqItem.findUnique({
            where: { id: shipmentForAuth.rfqItemId },
            include: {
              rfq: {
                include: {
                  buyer: {
                    select: { id: true, username: true },
                  },
                },
              },
            },
          });

          if (rfqItem && rfqItem.rfq) {
            // 所有管理员
            const admins = await this.prisma.user.findMany({
              where: { role: 'ADMIN' },
              select: { id: true, username: true },
            });

            const buyer = rfqItem.rfq.buyer;
            const notifiedUserIds = new Set<string>();

            const trackingDesc =
              `${ocrResult.trackingNo}` +
              (ocrResult.carrier ? `，${ocrResult.carrier}` : '');

            // 通知采购员（如果采购员不是管理员，避免重复通知）
            if (buyer && !notifiedUserIds.has(rfqItem.rfq.buyerId)) {
              const isBuyerAdmin = admins.some(
                (admin) => admin.id === rfqItem.rfq.buyerId,
              );
              if (!isBuyerAdmin) {
                await this.notificationService.create({
                  userId: rfqItem.rfq.buyerId,
                  type: 'SHIPMENT_UPDATE',
                  title: '运单号已更新',
                  content: `供应商已上传运单号：${trackingDesc}，商品：${rfqItem.productName}`,
                  link: `/rfqs/${rfqItem.rfqId}`,
                  userName: buyer?.username || undefined,
                });
                notifiedUserIds.add(rfqItem.rfq.buyerId);
              }
            }

            // 通知所有管理员（去重）
            for (const admin of admins) {
              if (!notifiedUserIds.has(admin.id)) {
                await this.notificationService.create({
                  userId: admin.id,
                  type: 'SHIPMENT_UPDATE',
                  title: '运单号已更新',
                  content: `供应商已上传运单号：${trackingDesc}，商品：${rfqItem.productName}`,
                  link: `/rfqs/${rfqItem.rfqId}`,
                  userName: admin.username || undefined,
                });
                notifiedUserIds.add(admin.id);
              }
            }
          }
        }
      } catch (error: any) {
        // 如果更新失败，只记录错误并回退 autoFilled 状态
        console.error(
          '[ShipmentService] 更新发货单运单号失败:',
          error?.message || error,
        );
        await this.prisma.trackingExtract.update({
          where: { id: trackingExtract.id },
          data: {
            autoFilled: false,
          },
        });
      }
    }

    return {
      trackingExtract,
      autoFilled: ocrResult.confidence >= 0.85,
    };
  }

  async findAll(filters?: {
    supplierId?: string;
    status?: string;
    orderId?: string;
    storeId?: string;
  }) {
    const where: any = {
      supplierId: filters?.supplierId,
      status: filters?.status as any,
      orderId: filters?.orderId,
    };

    // 门店用户只能看到自己门店的发货单（通过关联的订单或 RFQ）
    if (filters?.storeId) {
      where.OR = [
        { order: { storeId: filters.storeId } },
        { rfqItem: { rfq: { storeId: filters.storeId } } },
      ];
    }

    return this.prisma.shipment.findMany({
      where,
      include: {
        order: true,
        supplier: {
          select: {
            id: true,
            username: true,
          },
        },
        packages: true,
        ocrResults: {
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findOne(id: string, storeId?: string) {
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        order: true,
        award: {
          include: {
            rfq: {
              select: {
                storeId: true,
              },
            },
          },
        },
        rfqItem: {
          include: {
            rfq: {
              select: {
                storeId: true,
              },
            },
          },
        },
        supplier: true,
        packages: true,
        ocrResults: true,
        settlements: true,
      },
    });

    // 门店用户只能查看自己门店的发货单
    if (storeId && shipment) {
      const shipmentStoreId =
        shipment.order?.storeId ||
        shipment.rfqItem?.rfq?.storeId ||
        shipment.award?.rfq?.storeId;
      if (shipmentStoreId !== storeId) {
        throw new NotFoundException('无权访问该发货单');
      }
    }

    return shipment;
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.shipment.update({
      where: { id },
      data: { status: status as any },
    });
  }

  /**
   * 更新发货单快递单号
   */
  async updateTracking(
    id: string,
    trackingNo: string,
    carrier?: string,
    supplierId?: string,
  ) {
    // 验证发货单是否存在
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException('发货单不存在');
    }

    // 如果是供应商操作，验证权限
    if (supplierId && shipment.supplierId !== supplierId) {
      throw new BadRequestException('无权修改此发货单');
    }

    // 更新发货单
    const updated = await this.prisma.shipment.update({
      where: { id },
      data: {
        trackingNo: trackingNo.trim(),
        carrier: carrier?.trim() || null,
        status: 'SHIPPED' as any,
        shippedAt: new Date(),
      },
      include: {
        order: {
          include: {
            store: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    // 通知门店用户
    if (updated.order?.storeId) {
      const storeUsers = await this.prisma.user.findMany({
        where: {
          storeId: updated.order.storeId,
          role: 'STORE',
        },
      });

      for (const user of storeUsers) {
        await this.notificationService.create({
          userId: user.id,
          type: 'SHIPMENT_UPDATE',
          title: '订单已发货',
          content: `订单 ${updated.order.orderNo} 已发货，快递单号：${trackingNo}${carrier ? ` (${carrier})` : ''}`,
          link: `/orders`,
          userName: user.username,
        });
      }
    }

    return updated;
  }

  /**
   * 上传发货照片/视频
   */
  async uploadPhoto(
    id: string,
    file: Express.Multer.File,
    supplierId?: string,
  ) {
    // 验证发货单是否存在
    const shipment = await this.prisma.shipment.findUnique({
      where: { id },
    });

    if (!shipment) {
      throw new NotFoundException('发货单不存在');
    }

    // 如果是供应商操作，验证权限
    if (supplierId && shipment.supplierId !== supplierId) {
      throw new BadRequestException('无权上传此发货单的照片');
    }

    // 上传文件到 MinIO
    const fileUrl = await this.storageService.uploadFile(file, 'shipment-photos');

    // 从 URL 提取文件 key
    let fileKey: string;
    try {
      const url = new URL(fileUrl);
      let keyFromUrl = url.pathname.substring(1);
      if (keyFromUrl.startsWith('eggpurchase/')) {
        keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
      }
      fileKey = keyFromUrl;
    } catch {
      fileKey = fileUrl;
    }

    // 创建或更新包裹记录（用于存储照片/视频）
    let packageRecord = await this.prisma.package.findFirst({
      where: {
        shipmentId: id,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!packageRecord) {
      packageRecord = await this.prisma.package.create({
        data: {
          shipmentId: id,
          packageNo: `PKG-${Date.now()}`,
          photos: [fileKey] as any,
        },
      });
    } else {
      // 追加照片到现有包裹
      const existingPhotos = Array.isArray(packageRecord.photos)
        ? (packageRecord.photos as string[])
        : [];
      const updatedPhotos = [...existingPhotos, fileKey];
      packageRecord = await this.prisma.package.update({
        where: { id: packageRecord.id },
        data: {
          photos: updatedPhotos as any,
        },
      });
    }

    return {
      shipment,
      package: packageRecord,
      photoUrl: fileUrl,
    };
  }

  /**
   * 上传付款截图并创建/更新结算记录
   */
  async uploadPaymentScreenshot(
    shipmentId: string,
    file: Express.Multer.File,
    userId?: string,
  ) {
    // 校验发货单是否存在
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
      include: {
        order: {
          include: {
            store: {
              select: {
                id: true,
              },
            },
          },
        },
        rfqItem: {
          include: {
            rfq: {
              include: {
                items: {
                  include: {
                    quoteItems: {
                      include: {
                        quote: true,
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
      },
    });

    if (!shipment) {
      throw new NotFoundException('发货单不存在');
    }

    // 如果是门店用户，验证权限：只能上传自己门店的现货订单的付款截图
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true, storeId: true },
      });

      if (user?.role === 'STORE') {
        // 门店用户只能上传自己门店的订单
        if (shipment.source === 'ECOMMERCE' && shipment.order) {
          if (shipment.order.storeId !== user.storeId) {
            throw new BadRequestException('无权上传此订单的付款截图');
          }
        } else {
          throw new BadRequestException('门店用户只能上传现货订单的付款截图');
        }
      }
    }

    // 上传文件到 MinIO
    const fileUrl = await this.storageService.uploadFile(
      file,
      'payment-screenshots',
    );

    // 从 URL 中提取文件 key（用于保存到数据库）
    let fileKey: string;
    try {
      const url = new URL(fileUrl);
      let keyFromUrl = url.pathname.substring(1);
      if (keyFromUrl.startsWith('eggpurchase/')) {
        keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
      }
      fileKey = keyFromUrl;
    } catch {
      fileKey = fileUrl;
    }

    // 根据订单类型计算结算金额
    let amount = 0;
    
    // 如果是现货订单（ECOMMERCE），使用订单价格
    if (shipment.source === 'ECOMMERCE' && shipment.order) {
      amount = parseFloat(shipment.order.price?.toString() || '0');
    } 
    // 如果是询价单订单，根据 RFQ 报价计算结算金额
    else if (shipment.rfqItem?.rfq?.items) {
      const rfqItem = shipment.rfqItem.rfq.items.find(
        (item) => item.id === shipment.rfqItemId,
      );
      if (rfqItem?.quoteItems && rfqItem.quoteItems.length > 0) {
        const bestQuoteItem = rfqItem.quoteItems[0];
        amount =
          parseFloat(bestQuoteItem.price.toString()) *
          (rfqItem.quantity || 1);
      }
    }

    // 查找或创建结算记录
    let settlement = await this.prisma.settlement.findFirst({
      where: { shipmentId },
      orderBy: { createdAt: 'desc' },
    });

    if (settlement) {
      settlement = await this.prisma.settlement.update({
        where: { id: settlement.id },
        data: {
          qrCodeUrl: fileKey,
          status: 'PAID',
          paidAt: new Date(),
          amount: amount > 0 ? amount : settlement.amount,
        },
      });
    } else {
      const settlementNo = `SETTLE-${Date.now()}`;
      settlement = await this.prisma.settlement.create({
        data: {
          settlementNo,
          shipmentId,
          amount: amount > 0 ? amount : 0,
          qrCodeUrl: fileKey,
          status: 'PAID',
          paidAt: new Date(),
        },
      });
    }

    // 审计日志
    await this.auditService.log({
      action: 'settlement.payment_screenshot_uploaded',
      resource: 'Settlement',
      resourceId: settlement.id,
      userId,
      details: {
        shipmentId,
        settlementNo: settlement.settlementNo,
        amount: settlement.amount,
      },
    });

    return settlement;
  }

  /**
   * 批量上传付款截图（按供应商 + RFQ 分组）
   * 为多个发货单创建/更新结算记录，共用同一张付款截图
   */
  async uploadPaymentScreenshotBatch(
    primaryShipmentId: string,
    shipmentIds: string[],
    rfqId?: string,
    file?: Express.Multer.File,
    userId?: string,
  ) {
    if (!file) {
      throw new Error('请上传文件');
    }

    // 上传文件到 MinIO
    const fileUrl = await this.storageService.uploadFile(
      file,
      'payment-screenshots',
    );

    // 从 URL 提取文件 key
    let fileKey: string;
    try {
      const url = new URL(fileUrl);
      let keyFromUrl = url.pathname.substring(1);
      if (keyFromUrl.startsWith('eggpurchase/')) {
        keyFromUrl = keyFromUrl.substring('eggpurchase/'.length);
      }
      fileKey = keyFromUrl;
    } catch {
      fileKey = fileUrl;
    }

    // 计算总金额（基于所有发货单对应的 RFQ 商品，去重同一个 rfqItem）
    let totalAmount = 0;
    const processedRfqItems = new Set<string>();

    for (const shipmentId of shipmentIds) {
      const shipment = await this.prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: {
          rfqItem: {
            include: {
              rfq: {
                include: {
                  items: {
                    include: {
                      quoteItems: {
                        include: {
                          quote: true,
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
        },
      });

      if (shipment && shipment.rfqItem && shipment.rfqItem.rfq?.items) {
        const rfqItem = shipment.rfqItem.rfq.items.find(
          (item) => item.id === shipment.rfqItemId,
        );
        if (rfqItem && !processedRfqItems.has(rfqItem.id)) {
          processedRfqItems.add(rfqItem.id);
          if (rfqItem.quoteItems && rfqItem.quoteItems.length > 0) {
            const bestQuoteItem = rfqItem.quoteItems[0];
            totalAmount +=
              parseFloat(bestQuoteItem.price.toString()) *
              (rfqItem.quantity || 1);
          }
        }
      }
    }

    // 为每个发货单创建或更新结算记录
    const settlements = [];
    for (const shipmentId of shipmentIds) {
      let settlement = await this.prisma.settlement.findFirst({
        where: { shipmentId },
        orderBy: { createdAt: 'desc' },
      });

      if (settlement) {
        settlement = await this.prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            qrCodeUrl: fileKey,
            status: 'PAID',
            paidAt: new Date(),
            amount: totalAmount > 0 ? totalAmount : settlement.amount,
          },
        });
      } else {
        const settlementNo = `SETTLE-${Date.now()}-${shipmentId.substring(0, 8)}`;
        settlement = await this.prisma.settlement.create({
          data: {
            settlementNo,
            shipmentId,
            amount: totalAmount > 0 ? totalAmount : 0,
            qrCodeUrl: fileKey,
            status: 'PAID',
            paidAt: new Date(),
          },
        });
      }

      settlements.push(settlement);

      // 需要补充 rfqId / buyerId 时，单独查一次 shipment
      const shipmentWithRfq = await this.prisma.shipment.findUnique({
        where: { id: shipmentId },
        include: { rfqItem: { include: { rfq: true } } },
      });

      const effectiveUserId =
        userId || shipmentWithRfq?.rfqItem?.rfq?.buyerId;
      const effectiveRfqId =
        rfqId || shipmentWithRfq?.rfqItem?.rfqId || undefined;

      // 审计日志
      await this.auditService.log({
        action: 'settlement.payment_screenshot_uploaded_batch',
        resource: 'Settlement',
        resourceId: settlement.id,
        userId: effectiveUserId,
        details: {
          shipmentId,
          rfqId: effectiveRfqId,
          settlementNo: settlement.settlementNo,
          amount: settlement.amount,
          batchSize: shipmentIds.length,
        },
      });
    }

    return {
      settlements,
      totalAmount,
      shipmentCount: shipmentIds.length,
    };
  }
}
