import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import axios from 'axios';
import { detectCarrier, getCarrierName, getCarrierQueryUrl, getBaiduQueryUrl } from '../../common/utils/tracking.util';

export interface TrackingResult {
  success: boolean;
  trackingNo: string;
  carrier?: string;
  carrierName?: string;
  status?: string;
  statusText?: string;
  tracks?: Array<{
    time: string;
    context: string;
    location?: string;
  }>;
  message?: string;
}

@Injectable()
export class TrackingService {
  private readonly logger = new Logger(TrackingService.name);
  private readonly kuaidi100ApiKey: string;
  private readonly kuaidi100Customer: string;

  constructor(@Optional() private configService?: ConfigService) {
    // 从环境变量读取快递100的配置（可选）
    // 优先使用 ConfigService，如果不可用则使用 process.env
    this.kuaidi100ApiKey = this.configService?.get<string>('KUAIDI100_API_KEY') || process.env.KUAIDI100_API_KEY || '';
    this.kuaidi100Customer = this.configService?.get<string>('KUAIDI100_CUSTOMER') || process.env.KUAIDI100_CUSTOMER || '';
  }

  /**
   * 识别快递公司（使用工具函数）
   */
  private detectCarrier(trackingNo: string): string {
    return detectCarrier(trackingNo);
  }

  /**
   * 使用快递100 API查询物流信息
   */
  async queryByKuaidi100(trackingNo: string, carrier?: string): Promise<TrackingResult> {
    try {
      // 如果没有指定快递公司，尝试自动识别
      const detectedCarrier = carrier || this.detectCarrier(trackingNo);
      
      // 如果配置了快递100的API Key，使用官方API
      if (this.kuaidi100ApiKey && this.kuaidi100Customer) {
        const url = 'https://poll.kuaidi100.com/poll/query.do';
        const params = new URLSearchParams();
        params.append('customer', this.kuaidi100Customer);
        params.append('param', JSON.stringify({
          com: detectedCarrier || 'auto',
          num: trackingNo,
        }));
        
        // 生成签名
        const sign = crypto
          .createHash('md5')
          .update(params.get('param') + this.kuaidi100ApiKey + this.kuaidi100Customer)
          .digest('hex')
          .toUpperCase();
        params.append('sign', sign);

        const response = await axios.post(url, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        if (response.data.message === 'ok') {
          return {
            success: true,
            trackingNo,
            carrier: detectedCarrier,
            carrierName: getCarrierName(response.data.com || detectedCarrier || carrier || ''),
            status: response.data.state,
            statusText: this.getStatusText(response.data.state),
            tracks: response.data.data?.map((item: any) => ({
              time: item.time,
              context: item.context,
              location: item.location,
            })) || [],
          };
        } else {
          return {
            success: false,
            trackingNo,
            message: response.data.message || '查询失败',
          };
        }
      } else {
        // 如果没有配置API Key，使用免费查询接口（通过百度搜索）
        return await this.queryByBaidu(trackingNo, detectedCarrier);
      }
    } catch (error: any) {
      this.logger.error('快递100查询失败', error.stack || error.message);
      // 降级到百度查询
      return await this.queryByBaidu(trackingNo, carrier);
    }
  }

  /**
   * 通过百度搜索查询快递信息（降级方案）
   */
  async queryByBaidu(trackingNo: string, carrier?: string): Promise<TrackingResult> {
    try {
      // 构建百度搜索URL
      const searchUrl = `https://www.baidu.com/s?ie=utf-8&wd=${encodeURIComponent(trackingNo)}`;
      
      // 由于无法直接解析百度搜索结果，我们返回一个包含百度链接的结果
      return {
        success: true,
        trackingNo,
        carrier: carrier || this.detectCarrier(trackingNo),
        message: '请点击链接查看物流详情',
        tracks: [{
          time: new Date().toISOString(),
          context: `快递单号: ${trackingNo}`,
        }],
      };
    } catch (error: any) {
      this.logger.error('百度查询失败', error.stack || error.message);
      return {
        success: false,
        trackingNo,
        message: '查询失败，请稍后重试',
      };
    }
  }

  /**
   * 查询快递信息（主方法）
   */
  async queryTracking(trackingNo: string, carrier?: string): Promise<TrackingResult> {
    if (!trackingNo || !trackingNo.trim()) {
      return {
        success: false,
        trackingNo: trackingNo || '',
        message: '快递单号不能为空',
      };
    }

    const cleanTrackingNo = trackingNo.trim();
    
    // 优先使用快递100 API
    if (this.kuaidi100ApiKey && this.kuaidi100Customer) {
      return await this.queryByKuaidi100(cleanTrackingNo, carrier);
    } else {
      // 降级到百度查询
      return await this.queryByBaidu(cleanTrackingNo, carrier);
    }
  }

  /**
   * 获取状态文本
   */
  private getStatusText(status: string): string {
    const statusMap: Record<string, string> = {
      '0': '在途',
      '1': '揽收',
      '2': '疑难',
      '3': '已签收',
      '4': '退签',
      '5': '派件',
      '6': '退回',
      '7': '转投',
      '10': '待清关',
      '11': '清关中',
      '12': '已清关',
      '13': '清关异常',
      '14': '收件人拒签',
    };
    return statusMap[status] || '未知状态';
  }

  /**
   * 生成百度查询链接（使用工具函数）
   */
  getBaiduQueryUrl(trackingNo: string): string {
    return getBaiduQueryUrl(trackingNo);
  }

  /**
   * 生成快递公司官网查询链接（使用工具函数）
   */
  getCarrierQueryUrl(trackingNo: string, carrier?: string): string | null {
    return getCarrierQueryUrl(trackingNo, carrier);
  }
}

