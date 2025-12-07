import { Controller, Get, Post, Patch, Param, Body, UseInterceptors, UploadedFile, UseGuards, Request, BadRequestException, Logger } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AwardService } from './award.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { singleFileConfig } from '../../common/config/multer.config';

@ApiTags('涓爣')
@Controller('awards')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class AwardController {
  private readonly logger = new Logger(AwardController.name);

  constructor(private awardService: AwardService) {}

  @Get()
  @ApiOperation({ summary: '鑾峰彇涓爣鍒楄〃' })
  findAll(@Request() req) {
    // console.log(`[AwardController] 鑾峰彇涓爣鍒楄〃锛岀敤鎴疯鑹? ${req.user.role}, 鐢ㄦ埛ID: ${req.user.id}`);
    try {
      if (req.user.role === 'SUPPLIER') {
        // console.log(`[AwardController] 璋冪敤 findBySupplier(${req.user.id})`);
        // 浼犻€掕姹傜殑 Origin 澶达紝鐢ㄤ簬鐢熸垚姝ｇ‘鐨?MinIO 绛惧悕 URL
        const requestOrigin = req.headers.origin || req.headers.referer;
        return this.awardService.findBySupplier(req.user.id, requestOrigin).then(result => {
          // console.log(`[AwardController] findBySupplier 杩斿洖缁撴灉鏁伴噺: ${Array.isArray(result) ? result.length : '闈炴暟缁?}`);
          return result;
        }).catch(error => {
          console.error(`[AwardController] findBySupplier 閿欒:`, error);
          throw error;
        });
      } else if (req.user.role === 'ADMIN' || req.user.role === 'BUYER') {
        // console.log(`[AwardController] 璋冪敤 findByBuyer(${req.user.id})`);
        // 浼犻€掕姹傜殑 Origin 澶达紝鐢ㄤ簬鐢熸垚姝ｇ‘鐨?MinIO 绛惧悕 URL
        const requestOrigin = req.headers.origin || req.headers.referer;
        return this.awardService.findByBuyer(req.user.id, requestOrigin);
      } else if (req.user.role === 'STORE') {
        // 门店用户只能看到自己门店的中标订单
        if (!req.user.storeId) {
          this.logger.warn(`门店用户 ${req.user.id} 没有 storeId，无法查询数据`);
          throw new BadRequestException('门店用户必须关联门店才能查看数据');
        }
        const requestOrigin = req.headers.origin || req.headers.referer;
        this.logger.debug(`门店用户查询中标订单，storeId: ${req.user.storeId}, userId: ${req.user.id}`);
        return this.awardService.findByBuyer(req.user.id, requestOrigin, req.user.storeId);
      } else {
        throw new Error('Unauthorized');
      }
    } catch (error) {
      console.error(`[AwardController] findAll 閿欒:`, error);
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: '鑾峰彇涓爣璇︽儏' })
  findOne(@Param('id') id: string, @Request() req) {
    return this.awardService.findOne(id);
  }

  @Post(':id/payment-qrcode')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '涓婁紶鏀跺浜岀淮鐮?' })
  uploadPaymentQrCode(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('Only suppliers can upload payment QR code');
    }
    return this.awardService.uploadPaymentQrCode(id, file, req.user.id);
  }

  @Post(':id/tracking')
  @ApiOperation({ summary: '涓婁紶鐗╂祦鍗曞彿' })
  uploadTrackingNumber(
    @Param('id') id: string,
    @Body() body: { rfqItemId: string; trackingNo: string; carrier: string },
    @Request() req,
  ) {
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('Only suppliers can upload tracking number');
    }
    return this.awardService.uploadTrackingNumber(
      id,
      body.rfqItemId,
      body.trackingNo,
      body.carrier,
      req.user.id,
    );
  }

  @Post(':id/shipment-photos')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '涓婁紶鍙戣揣鐓х墖鎴栬棰?' })
  uploadShipmentPhotos(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    if (req.user.role !== 'SUPPLIER') {
      throw new BadRequestException('Only suppliers can upload shipment photos');
    }

    if (!file) {
      throw new BadRequestException('No file uploaded');
    }

    // 浠?req.body 涓幏鍙?rfqItemId锛坢ultipart/form-data 瀛楁鍦?req.body 涓級
    const rfqItemId = req.body?.rfqItemId;
    
    if (!rfqItemId) {
      throw new BadRequestException('rfqItemId is required');
    }

    return this.awardService.uploadShipmentPhotos(
      id,
      rfqItemId,
      file,
      req.user.id,
    );
  }

  @Post(':id/out-of-stock')
  @ApiOperation({ summary: '渚涘簲鍟嗘爣璁扮己璐?' })
  markOutOfStock(
    @Param('id') id: string,
    @Body() body: { reason: string; rfqItemId?: string },
    @Request() req,
  ) {
    if (req.user.role !== 'SUPPLIER') {
      throw new BadRequestException('Only suppliers can mark out of stock');
    }
    return this.awardService.markOutOfStock(id, req.user.id, body.reason, body.rfqItemId);
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: '閲囪喘鍛樺彇娑堜腑鏍?' })
  cancelAward(
    @Param('id') id: string,
    @Body() body: { reason: string; action: 'CANCEL' | 'SWITCH_TO_ECOMMERCE' | 'REASSIGN' },
    @Request() req,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new BadRequestException('Only buyers and admins can cancel awards');
    }
    return this.awardService.cancelAward(id, req.user.id, body.reason, body.action);
  }

  @Post(':id/recreate-rfq')
  @ApiOperation({ summary: '鍩轰簬缂鸿揣鐨勪腑鏍囬噸鏂板垱寤鸿浠峰崟' })
  recreateRfq(
    @Param('id') id: string,
    @Body() body: { deadline?: string },
    @Request() req,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new BadRequestException('Only buyers, admins, and store users can recreate RFQ');
    }
    const deadline = body.deadline ? new Date(body.deadline) : undefined;
    return this.awardService.recreateRfqFromOutOfStock(id, req.user.id, deadline, req.user.role, req.user.storeId);
  }

  @Post(':id/convert-to-ecommerce')
  @ApiOperation({ summary: '灏嗙己璐у晢鍝佽浆涓虹數鍟嗗钩鍙伴噰璐?' })
  convertToEcommerce(
    @Param('id') id: string,
    @Body() body: { rfqItemIds?: string[] },
    @Request() req,
  ) {
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER' && req.user.role !== 'STORE') {
      throw new BadRequestException('Only buyers, admins, and store users can convert to ecommerce');
    }
    return this.awardService.convertToEcommerce(id, req.user.id, body.rfqItemIds, req.user.role, req.user.storeId);
  }
}

