import { Controller, Get, Post, Body, Param, Patch, UseGuards, Request, Query, UseInterceptors, UploadedFile, UploadedFiles } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { AfterSalesService } from './after-sales.service';
import { CreateAfterSalesDto } from './dto/create-after-sales.dto';
import { UpdateResolutionDto } from './dto/update-resolution.dto';
import { UploadReplacementTrackingDto } from './dto/upload-replacement-tracking.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { multipleFilesConfig } from '../../common/config/multer.config';
import { getStoreFilter } from '../../common/utils/store-filter.util';

@ApiTags('售后')
@Controller('after-sales')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AfterSalesController {
  constructor(private afterSalesService: AfterSalesService) {}

  @Post()
  @ApiOperation({ summary: '创建售后工单' })
  create(@Body() createAfterSalesDto: CreateAfterSalesDto, @Request() req) {
    return this.afterSalesService.create(createAfterSalesDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: '获取售后工单列表' })
  findAll(@Query() filters: any, @Request() req) {
    // ADMIN可以看到所有售后工单
    // 供应商只能看到自己的工单
    if (req.user.role === 'SUPPLIER') {
      filters.supplierId = req.user.id;
    }
    // 门店用户只能看到自己门店的售后工单
    // ADMIN不受门店过滤限制
    const storeFilter = getStoreFilter(req.user);
    if (storeFilter.storeId && req.user.role !== 'ADMIN') {
      filters.storeId = storeFilter.storeId;
    }
    return this.afterSalesService.findAll(filters);
  }

  @Get('stats')
  @ApiOperation({ summary: '获取售后工单统计' })
  getStats(@Request() req) {
    // ADMIN可以看到所有统计
    // 供应商只能统计自己的工单
    const supplierId = req.user.role === 'SUPPLIER' ? req.user.id : undefined;
    // 门店用户只能统计自己门店的售后工单
    // ADMIN不受门店过滤限制
    const storeFilter = getStoreFilter(req.user);
    const storeId = req.user.role === 'ADMIN' ? undefined : (storeFilter.storeId || undefined);
    return this.afterSalesService.getStats(supplierId, storeId);
  }

  @Get('tracking/:trackingNo')
  @ApiOperation({ summary: '通过快递单号查找发货信息' })
  findByTrackingNo(@Param('trackingNo') trackingNo: string) {
    return this.afterSalesService.findByTrackingNo(trackingNo);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取售后工单详情' })
  findOne(@Param('id') id: string) {
    return this.afterSalesService.findOne(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: '更新售后工单状态' })
  updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Body('description') description: string,
    @Request() req,
  ) {
    return this.afterSalesService.updateStatus(id, status, req.user.id, description);
  }

  @Post(':id/attachments')
  @UseInterceptors(FilesInterceptor('files', 10, multipleFilesConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传售后工单附件' })
  uploadAttachments(
    @Param('id') id: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Request() req,
  ) {
    if (!files || files.length === 0) {
      throw new Error('请选择要上传的文件');
    }
    return this.afterSalesService.uploadAttachments(id, files, req.user.id);
  }

  @Patch(':id/resolution')
  @ApiOperation({ summary: '更新售后处理方案和进度（供应商，不改变状态）' })
  updateResolution(
    @Param('id') id: string,
    @Body() updateResolutionDto: UpdateResolutionDto,
    @Request() req,
  ) {
    return this.afterSalesService.updateResolution(
      id,
      updateResolutionDto.resolution,
      updateResolutionDto.progressDescription,
      req.user.id,
    );
  }

  @Patch(':id/assign')
  @ApiOperation({ summary: '下发工单给供应商（管理员/采购员）' })
  assignToSupplier(
    @Param('id') id: string,
    @Body('supplierId') supplierId: string,
    @Request() req,
  ) {
    // 只有管理员和采购员可以下发工单
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new Error('仅管理员和采购员可以下发工单');
    }
    return this.afterSalesService.assignToSupplier(id, supplierId, req.user.id);
  }

  @Post(':id/submit-resolution')
  @ApiOperation({ summary: '供应商提交处理方案（供应商）' })
  submitResolution(
    @Param('id') id: string,
    @Body('resolution') resolution: string,
    @Request() req,
  ) {
    return this.afterSalesService.submitResolution(id, resolution, req.user.id);
  }

  @Patch(':id/confirm')
  @ApiOperation({ summary: '确认售后完成（管理员/采购员）' })
  confirmResolution(
    @Param('id') id: string,
    @Body('confirmed') confirmed: boolean,
    @Request() req,
  ) {
    // 只有管理员和采购员可以确认售后完成
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new Error('仅管理员和采购员可以确认售后完成');
    }
    return this.afterSalesService.confirmResolution(id, req.user.id, confirmed);
  }

  @Post(':id/replacement-tracking')
  @ApiOperation({ summary: '上传换货快递单号（供应商，仅限换货类型）' })
  uploadReplacementTracking(
    @Param('id') id: string,
    @Body() uploadReplacementTrackingDto: UploadReplacementTrackingDto,
    @Request() req,
  ) {
    return this.afterSalesService.uploadReplacementTracking(
      id,
      uploadReplacementTrackingDto.trackingNo,
      uploadReplacementTrackingDto.carrier,
      req.user.id,
    );
  }
}

