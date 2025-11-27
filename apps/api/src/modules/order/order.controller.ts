import { Controller, Get, Post, Body, Param, Patch, UseGuards, Query, UseInterceptors, UploadedFile, Request, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { CreateOrderFromInventoryDto } from './dto/create-order-from-inventory.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { singleFileConfig } from '../../common/config/multer.config';
import { getStoreFilter } from '../../common/utils/store-filter.util';

@ApiTags('订单')
@Controller('orders')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class OrderController {
  constructor(private orderService: OrderService) {}

  @Post('from-inventory')
  @ApiOperation({ summary: '从供应商库存创建订单（门店下单）' })
  createFromInventory(@Body() createOrderDto: CreateOrderFromInventoryDto, @Request() req) {
    // 只有门店用户、采购员和管理员可以从库存下单
    if (req.user.role !== 'STORE' && req.user.role !== 'BUYER' && req.user.role !== 'ADMIN') {
      throw new ForbiddenException('只有门店用户、采购员和管理员可以从库存下单');
    }
    // 如果是门店用户，自动设置storeId和buyerId
    if (req.user.role === 'STORE' && req.user.storeId) {
      createOrderDto.storeId = req.user.storeId;
      createOrderDto.buyerId = req.user.id;
    }
    return this.orderService.createFromInventory(createOrderDto);
  }

  @Post()
  @ApiOperation({ summary: '创建订单' })
  create(@Body() createOrderDto: CreateOrderDto) {
    return this.orderService.create(createOrderDto);
  }

  @Get()
  @ApiOperation({ summary: '获取订单列表' })
  findAll(@Query() filters: any, @Request() req) {
    // ADMIN可以看到所有订单
    // 门店用户只能看到自己门店的订单
    const storeFilter = getStoreFilter(req.user);
    // ADMIN不受门店过滤限制
    const queryFilters = req.user.role === 'ADMIN' 
      ? filters 
      : { ...filters, ...storeFilter };
    const requestOrigin = req.headers.origin || req.headers.host;
    return this.orderService.findAll(queryFilters, requestOrigin);
  }

  // 历史数据相关路由必须在 :id 路由之前，否则会被 :id 路由匹配
  @Get('history/data')
  @ApiOperation({ summary: '查询历史表格数据' })
  findHistoryData(@Query() filters: any, @Request() req) {
    const parsedFilters: any = {};

    if (filters.startDate) {
      parsedFilters.startDate = new Date(filters.startDate);
    }
    if (filters.endDate) {
      // 设置为当天的23:59:59
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      parsedFilters.endDate = endDate;
    }
    if (filters.orderNo) {
      parsedFilters.orderNo = filters.orderNo;
    }
    if (filters.trackingNo) {
      parsedFilters.trackingNo = filters.trackingNo;
    }
    if (filters.recipient) {
      parsedFilters.recipient = filters.recipient;
    }
    if (filters.phone) {
      parsedFilters.phone = filters.phone;
    }
    if (filters.productName) {
      parsedFilters.productName = filters.productName;
    }
    if (filters.status) {
      parsedFilters.status = filters.status;
    }
    // ADMIN可以看到所有历史数据
    // 门店用户只能看到自己门店的历史数据
    const storeFilter = getStoreFilter(req.user);
    if (req.user.role === 'ADMIN') {
      // ADMIN不受门店过滤限制，但可以手动指定门店
      if (filters.storeId) {
        parsedFilters.storeId = filters.storeId;
      }
    } else if (storeFilter.storeId) {
      parsedFilters.storeId = storeFilter.storeId;
    } else if (filters.storeId) {
      parsedFilters.storeId = filters.storeId;
    }

    return this.orderService.findHistoryData(parsedFilters);
  }

  @Get('history/stats')
  @ApiOperation({ summary: '获取历史数据统计信息' })
  getHistoryStats(@Query() filters: any, @Request() req) {
    const parsedFilters: any = {};

    if (filters.startDate) {
      parsedFilters.startDate = new Date(filters.startDate);
    }
    if (filters.endDate) {
      const endDate = new Date(filters.endDate);
      endDate.setHours(23, 59, 59, 999);
      parsedFilters.endDate = endDate;
    }
    // ADMIN可以看到所有统计数据
    // 门店用户只能看到自己门店的统计数据
    const storeFilter = getStoreFilter(req.user);
    if (req.user.role === 'ADMIN') {
      // ADMIN不受门店过滤限制，但可以手动指定门店
      if (filters.storeId) {
        parsedFilters.storeId = filters.storeId;
      }
    } else if (storeFilter.storeId) {
      parsedFilters.storeId = storeFilter.storeId;
    } else if (filters.storeId) {
      parsedFilters.storeId = filters.storeId;
    }

    return this.orderService.getHistoryStats(parsedFilters);
  }

  @Post('history/import')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入历史数据（CSV/Excel）' })
  importHistoryData(
    @UploadedFile() file: Express.Multer.File,
    @Body('storeId') storeId: string,
    @Request() req,
  ) {
    // 只有管理员和采购员可以导入历史数据
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new ForbiddenException('仅管理员和采购员可以导入历史数据');
    }
    if (!file) {
      throw new Error('请上传文件');
    }
    if (!storeId) {
      throw new Error('请选择门店');
    }
    return this.orderService.importHistoryData(file, storeId);
  }

  @Patch('tracking')
  @ApiOperation({ summary: '根据订单号更新物流信息' })
  updateTrackingByOrderNo(
    @Body() body: { orderNo: string; trackingNo: string; carrier?: string },
    @Request() req,
  ) {
    const requestOrigin = req.headers.origin || req.headers.host;
    return this.orderService.updateTrackingByOrderNo(
      body.orderNo,
      body.trackingNo,
      body.carrier,
      requestOrigin,
    );
  }

  @Post('sync-all-tracking')
  @ApiOperation({ summary: '一键同步所有物流单号到订单系统' })
  syncAllTrackingToOrders(@Request() req) {
    // 只有管理员和采购员可以执行批量同步
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new ForbiddenException('仅管理员和采购员可操作');
    }
    return this.orderService.syncAllTrackingToOrders();
  }

  // 具体路由必须在动态路由 :id 之前，否则会被 :id 匹配
  @Get('supplier/orders')
  @ApiOperation({ summary: '获取供应商的订单列表（包括从库存下单的订单）' })
  findSupplierOrders(@Request() req, @Query('status') status?: string) {
    // 只有供应商可以查看自己的订单
    if (req.user.role !== 'SUPPLIER') {
      throw new ForbiddenException('只有供应商可以查看订单');
    }
    const requestOrigin = req.headers.origin || req.headers.host;
    return this.orderService.findSupplierOrders(req.user.id, { status }, requestOrigin);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取订单详情' })
  findOne(@Param('id') id: string, @Request() req) {
    // 门店用户只能查看自己门店的订单
    const storeFilter = getStoreFilter(req.user);
    const requestOrigin = req.headers.origin || req.headers.host;
    return this.orderService.findOne(id, storeFilter.storeId || undefined, requestOrigin);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '更新订单状态' })
  updateStatus(@Param('id') id: string, @Body('status') status: string) {
    return this.orderService.updateStatus(id, status);
  }
}

