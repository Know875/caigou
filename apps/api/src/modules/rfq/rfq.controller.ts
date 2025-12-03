import { Controller, Get, Post, Body, Param, Patch, Delete, Query, UseGuards, Request, UseInterceptors, UploadedFile, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { singleFileConfig } from '../../common/config/multer.config';
import { getStoreFilter } from '../../common/utils/store-filter.util';

@ApiTags('询价')
@Controller('rfqs')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RfqController {
  private readonly logger = new Logger(RfqController.name);

  constructor(private rfqService: RfqService) {}

  // 注意：from-file 路由必须在通用 @Post() 之前，否则会被通用路由匹配
  @Post('from-file')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '从文件创建询价单' })
  createFromFile(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Request() req,
  ) {
    // 供应商不能创建询价单
    if (req.user.role === 'SUPPLIER') {
      throw new Error('供应商无权创建询价单');
    }
    // 门店用户自动设置为自己的门店ID
    if (req.user.role === 'STORE' && req.user.storeId) {
      body.storeId = req.user.storeId;
      this.logger.debug('门店用户从文件创建询价单，自动设置为自己的门店', { storeId: req.user.storeId });
    }
    console.log('📋 [Controller] 收到从文件创建询价单的请求');
    console.log('📋 [Controller] 文件信息:', {
      hasFile: !!file,
      fileName: file?.originalname,
      fileSize: file?.size,
      fileMimetype: file?.mimetype,
    });
    console.log('📋 [Controller] 请求体信息:', {
      title: body.title,
      description: body.description,
      type: body.type,
      deadline: body.deadline,
      storeId: body.storeId,
    });
    
    if (!file) {
      this.logger.error('没有收到文件');
      throw new Error('请上传文件');
    }
    
    // 验证门店ID必填
    if (!body.storeId || body.storeId.trim() === '') {
      throw new Error('关联门店不能为空，请选择门店');
    }
    
    // 从body中提取其他字段
    const createRfqDto: CreateRfqDto = {
      title: body.title || '',
      description: body.description || '',
      type: body.type || 'NORMAL',
      deadline: body.deadline,
      storeId: body.storeId,
      orderIds: body.orderIds ? (Array.isArray(body.orderIds) ? body.orderIds : [body.orderIds]) : undefined,
    };
    
    this.logger.log(`从文件创建询价单: ${file.originalname}`);
    return this.rfqService.createFromFile(file, createRfqDto, req.user.id);
  }

  @Post()
  @ApiOperation({ summary: '创建询价单' })
  create(@Body() createRfqDto: CreateRfqDto, @Request() req) {
    // 供应商不能创建询价单
    if (req.user.role === 'SUPPLIER') {
      throw new Error('供应商无权创建询价单');
    }
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('收到创建询价单的请求', {
        title: createRfqDto.title,
        type: createRfqDto.type,
        itemsCount: createRfqDto.items?.length || 0,
        userRole: req.user.role,
        userStoreId: req.user.storeId,
      });
    }

    return this.rfqService.create(createRfqDto, req.user.id, req.user.role, req.user.storeId);
  }

  @Get('today-count')
  @ApiOperation({ summary: '获取当天已创建的询价单数量（用于计算序号）' })
  async getTodayRfqCount(@Query('storeId') storeId: string, @Request() req) {
    // 如果是STORE用户，自动使用自己的storeId
    const finalStoreId = req.user.role === 'STORE' && req.user.storeId 
      ? req.user.storeId 
      : storeId;
    
    if (!finalStoreId) {
      return { count: 0 };
    }
    
    const count = await this.rfqService.getTodayRfqCount(finalStoreId);
    return { count };
  }

  @Get()
  @ApiOperation({ summary: '获取询价单列表' })
  findAll(@Query() filters: any, @Request() req) {
    // 供应商可以看到所有已发布的询价单（自动过滤已过期的）
    if (req.user.role === 'SUPPLIER') {
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('供应商查询询价单', { userId: req.user.id, filters });
      }
      const queryFilters = { ...filters, status: 'PUBLISHED' };
      return this.rfqService.findAll(queryFilters);
    } else {
      // 门店用户只能看到自己门店的询价单
      const storeFilter = getStoreFilter(req.user, 'storeId');
      if (req.user.role === 'STORE') {
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug('门店用户查询询价单', { userId: req.user.id, storeId: req.user.storeId, filters });
        }
        const queryFilters = { ...filters, ...storeFilter };
        return this.rfqService.findAll(queryFilters);
      } else {
        // 采购员和管理员：可以看到所有询价单（包括其他人创建的）
        if (process.env.NODE_ENV === 'development') {
          this.logger.debug('采购员/管理员查询询价单', { userId: req.user.id, filters });
        }
        const queryFilters = { ...filters };
        return this.rfqService.findAll(queryFilters);
      }
    }
  }

  @Get('unquoted-items')
  @ApiOperation({ summary: '获取所有未报价的商品（需要从电商平台采购）' })
  getUnquotedItems(@Request() req) {
    // 门店用户、采购员和管理员可以查看
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new Error('无权访问');
    }
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('获取未报价商品', { userId: req.user.id, role: req.user.role, storeId: req.user.storeId });
    }
    // ADMIN可以看到所有未报价商品
    // 门店用户只能看到自己门店的未报价商品
    const storeFilter = getStoreFilter(req.user);
    const buyerId = req.user.role === 'STORE' ? undefined : undefined; // 门店用户不按buyerId过滤
    const storeId = req.user.role === 'ADMIN' ? undefined : (storeFilter.storeId || undefined);
    return this.rfqService.findUnquotedItems(
      buyerId,
      req.user.role,
      storeId
    );
  }

  @Get('shipment-overview')
  @ApiOperation({ summary: '获取所有询价单商品的发货状态总览（采购员用）' })
  async getShipmentOverview(@Request() req) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new Error('无权访问');
    }
    // ADMIN可以看到所有发货状态
    // 门店用户只能看到自己门店的发货状态
    const storeFilter = getStoreFilter(req.user);
    const buyerId = req.user.role === 'STORE' ? undefined : (req.user.role === 'ADMIN' ? undefined : req.user.id);
    const storeId = req.user.role === 'ADMIN' ? undefined : (storeFilter.storeId || undefined);
    return this.rfqService.getShipmentOverview(
      buyerId,
      storeId
    );
  }

  // 注意：更具体的路由（如 :id/publish）必须在通用路由（如 :id）之前
  @Patch(':id/publish')
  @ApiOperation({ summary: '发布询价单（需要所有商品都设置最高限价）' })
  publish(@Param('id') id: string, @Request() req) {
    // 供应商不能发布询价单
    if (req.user.role === 'SUPPLIER') {
      throw new Error('供应商无权发布询价单');
    }
    this.logger.log(`发布询价单: ${id}`, { userId: req.user.id, role: req.user.role });
    return this.rfqService.publishRfq(id, req.user.id).catch((error) => {
      this.logger.error(`发布询价单失败: ${id}`, error);
      throw error;
    });
  }

  @Patch(':id/close')
  @ApiOperation({ summary: '关闭询价单（截标）' })
  close(@Param('id') id: string, @Request() req) {
    // 供应商不能关闭询价单
    if (req.user.role === 'SUPPLIER') {
      throw new Error('供应商无权关闭询价单');
    }
    this.logger.log(`关闭询价单: ${id}`, { userId: req.user.id, role: req.user.role });
    return this.rfqService.closeRfq(id, req.user.id).catch((error) => {
      this.logger.error(`关闭询价单失败: ${id}`, error);
      throw error;
    });
  }

  @Post(':id/award-item')
  @ApiOperation({ summary: '按商品级别选商（手动选择某个供应商的某个商品报价）' })
  awardItem(
    @Param('id') rfqId: string,
    @Body() body: { rfqItemId: string; quoteItemId: string; quoteId: string; reason?: string },
    @Request() req,
  ) {
    // 只有管理员和采购员可以选商
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new Error('仅管理员和采购员可以选商');
    }
    console.log(`[RfqController] 收到按商品级别选商请求，RFQ ID: ${rfqId}, 商品ID: ${body.rfqItemId}, 报价项ID: ${body.quoteItemId}`);
    return this.rfqService.awardItem(rfqId, body.rfqItemId, body.quoteItemId, body.quoteId, body.reason, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取询价单详情' })
  findOne(@Param('id') id: string, @Request() req) {
    const supplierId = req.user.role === 'SUPPLIER' ? req.user.id : undefined;
    // 门店用户只能查看自己门店的询价单
    const storeFilter = getStoreFilter(req.user);
    return this.rfqService.findOne(id, supplierId, storeFilter.storeId || undefined);
  }

  @Patch('items/:itemId/tracking')
  @ApiOperation({ summary: '更新询价单商品的物流单号、快递公司和成本价' })
  updateTrackingNo(
    @Param('itemId') itemId: string,
    @Body() body: { trackingNo?: string; carrier?: string; costPrice?: number },
    @Request() req,
  ) {
    // 采购员、管理员和门店用户可以更新物流单号
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new Error('无权操作');
    }
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('更新物流信息', { itemId, trackingNo: body.trackingNo, carrier: body.carrier });
    }
    return this.rfqService.updateRfqItemTracking(itemId, body.trackingNo, body.carrier, body.costPrice, req.user.id);
  }

  @Patch('items/:itemId/ecommerce-status')
  @ApiOperation({ summary: '更新电商采购状态' })
  updateEcommerceStatus(
    @Param('itemId') itemId: string,
    @Body() body: { status: 'ECOMMERCE_PENDING' | 'ECOMMERCE_PAID' | 'ECOMMERCE_SHIPPED' },
    @Request() req,
  ) {
    // 采购员、管理员和门店用户可以更新状态
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new Error('无权操作');
    }
    // 这里需要调用 AwardService，但为了避免循环依赖，可以在 RfqService 中实现
    // 或者创建一个共享的服务
    return this.rfqService.updateEcommerceStatus(itemId, body.status, req.user.id);
  }

  @Patch('items/:itemId/max-price')
  @ApiOperation({ summary: '更新询价单商品的最高限价和一口价' })
  updateMaxPrice(
    @Param('itemId') itemId: string,
    @Body() body: { maxPrice: number; instantPrice?: number | null },
    @Request() req,
  ) {
    return this.rfqService.updateMaxPrice(itemId, body.maxPrice, req.user.id, body.instantPrice);
  }

  @Get('historical-prices')
  @ApiOperation({ summary: '根据商品名称查询最近5天内的历史价格（不限制门店）' })
  getHistoricalPrices(
    @Query('productName') productName: string,
  ) {
    if (!productName || productName.trim() === '') {
      return [];
    }
    // 不限制门店，查询所有门店的历史记录
    return this.rfqService.getHistoricalPrices(productName);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除询价单（草稿状态无限制，其他状态需要管理员权限）' })
  delete(@Param('id') id: string, @Request() req) {
    // 管理员、采购员和门店用户可以删除询价单
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new Error('仅管理员、采购员和门店用户可以删除询价单');
    }
    this.logger.log(`删除询价单: ${id}`, { userId: req.user.id, role: req.user.role });
    return this.rfqService.delete(id, req.user.id).catch((error) => {
      this.logger.error(`删除询价单失败: ${id}`, error);
      throw error;
    });
  }

  @Delete('items/:itemId')
  @ApiOperation({ summary: '删除询价单中的单个商品（仅管理员）' })
  deleteItem(@Param('itemId') itemId: string, @Request() req) {
    // 只有管理员可以删除单个商品
    if (req.user.role !== 'ADMIN') {
      throw new Error('仅管理员可以删除询价单中的商品');
    }
    this.logger.log(`删除询价单商品: ${itemId}`, { userId: req.user.id });
    return this.rfqService.deleteRfqItem(itemId, req.user.id).catch((error) => {
      this.logger.error(`删除询价单商品失败: ${itemId}`, error);
      throw error;
    });
  }
}
