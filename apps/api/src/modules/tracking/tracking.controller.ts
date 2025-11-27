import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { TrackingService } from './tracking.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('快递查询')
@Controller('tracking')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class TrackingController {
  constructor(private trackingService: TrackingService) {}

  @Get('query')
  @ApiOperation({ summary: '查询快递物流信息' })
  async queryTracking(
    @Query('trackingNo') trackingNo: string,
    @Query('carrier') carrier?: string,
  ) {
    if (!trackingNo) {
      throw new Error('快递单号不能为空');
    }
    return await this.trackingService.queryTracking(trackingNo, carrier);
  }

  @Get('baidu-url')
  @ApiOperation({ summary: '获取百度查询链接' })
  getBaiduUrl(@Query('trackingNo') trackingNo: string) {
    if (!trackingNo) {
      throw new Error('快递单号不能为空');
    }
    return {
      url: this.trackingService.getBaiduQueryUrl(trackingNo),
    };
  }

  @Get('carrier-url')
  @ApiOperation({ summary: '获取快递公司官网查询链接' })
  getCarrierUrl(@Query('trackingNo') trackingNo: string, @Query('carrier') carrier?: string) {
    if (!trackingNo) {
      throw new Error('快递单号不能为空');
    }
    const url = this.trackingService.getCarrierQueryUrl(trackingNo, carrier);
    return {
      url: url || this.trackingService.getBaiduQueryUrl(trackingNo),
      isCarrierSite: !!url,
    };
  }
}

