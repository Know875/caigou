import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  UseGuards,
  Request,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { ShipmentService } from './shipment.service';
import { CreateShipmentDto } from './dto/create-shipment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { singleFileConfig } from '../../common/config/multer.config';
import { getStoreFilter } from '../../common/utils/store-filter.util';

@ApiTags('发货')
@Controller('shipments')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ShipmentController {
  constructor(private shipmentService: ShipmentService) {}

  @Post()
  @ApiOperation({ summary: '创建发货单' })
  create(@Body() createShipmentDto: CreateShipmentDto, @Request() req) {
    // 只有供应商可以创建发货单
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('仅供应商可以创建发货单');
    }
    return this.shipmentService.create(createShipmentDto, req.user.id);
  }

  @Post(':id/upload-label')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传快递面单（OCR识别）' })
  uploadLabel(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req
  ) {
    // 验证权限：供应商只能上传自己的发货单
    if (req.user.role === 'SUPPLIER') {
      return this.shipmentService.uploadLabel(id, file, req.user.id);
    }
    return this.shipmentService.uploadLabel(id, file);
  }

  @Get()
  @ApiOperation({ summary: '获取发货单列表' })
  findAll(
    @Query() filters: {
      supplierId?: string;
      status?: string;
      orderId?: string;
      storeId?: string;
    },
    @Request() req
  ) {
    // ADMIN可以看到所有发货单
    // 供应商只能看到自己的发货单
    if (req.user.role === 'SUPPLIER') {
      filters.supplierId = req.user.id;
    }
    // 门店用户只能看到自己门店的发货单（通过关联的询价单或订单）
    // ADMIN不受门店过滤限制
    const storeFilter = getStoreFilter(req.user);
    if (storeFilter.storeId && req.user.role !== 'ADMIN') {
      filters.storeId = storeFilter.storeId;
    }
    return this.shipmentService.findAll(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取发货单详情' })
  findOne(@Param('id') id: string, @Request() req) {
    // 门店用户只能查看自己门店的发货单
    const storeFilter = getStoreFilter(req.user);
    return this.shipmentService.findOne(id, storeFilter.storeId || undefined);
  }

  @Patch(':id/tracking')
  @ApiOperation({ summary: '更新发货单快递单号' })
  updateTracking(
    @Param('id') id: string,
    @Body() body: { trackingNo: string; carrier?: string },
    @Request() req,
  ) {
    // 供应商只能更新自己的发货单
    if (req.user.role === 'SUPPLIER') {
      return this.shipmentService.updateTracking(id, body.trackingNo, body.carrier, req.user.id);
    }
    return this.shipmentService.updateTracking(id, body.trackingNo, body.carrier);
  }

  @Post(':id/photos')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传发货照片/视频' })
  uploadPhoto(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (!file) {
      throw new Error('请上传文件');
    }
    // 供应商只能上传自己发货单的照片
    if (req.user.role === 'SUPPLIER') {
      return this.shipmentService.uploadPhoto(id, file, req.user.id);
    }
    return this.shipmentService.uploadPhoto(id, file);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '更新发货单状态' })
  updateStatus(@Param('id') id: string, @Body('status') status: string, @Request() req) {
    return this.shipmentService.updateStatus(id, status);
  }

  @Post(':id/payment-screenshot')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传付款截图' })
  uploadPaymentScreenshot(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req
  ) {
    // 管理员、采购员和门店用户可以上传付款截图
    // 门店用户只能上传自己门店的现货订单的付款截图
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new Error('无权操作');
    }
    return this.shipmentService.uploadPaymentScreenshot(id, file, req.user.id);
  }

  @Post(':id/payment-screenshot-batch')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '批量上传付款截图（按供应商+RFQ）' })
  uploadPaymentScreenshotBatch(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { rfqId?: string; shipmentIds?: string },
    @Request() req
  ) {
    // 只有管理员和采购员可以上传付款截图
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new Error('无权操作');
    }
    // 解析 shipmentIds（可能是 JSON 字符串）
    let shipmentIds: string[] = [];
    if (body.shipmentIds) {
      try {
        shipmentIds = typeof body.shipmentIds === 'string' ? JSON.parse(body.shipmentIds) : body.shipmentIds;
      } catch (e) {
        shipmentIds = [id]; // 如果解析失败，只使用当前ID
      }
    } else {
      shipmentIds = [id];
    }
    return this.shipmentService.uploadPaymentScreenshotBatch(
      id,
      shipmentIds,
      body.rfqId,
      file,
      req.user.id
    );
  }
}
