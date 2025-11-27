import { Injectable, Inject } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../modules/prisma/prisma.service';
import { OcrService } from '../modules/ocr/ocr.service';
import { AuditService } from '../modules/audit/audit.service';

@Injectable()
export class OcrQueue {
  constructor(
    @Inject('OCR_QUEUE') private ocrQueue: Queue,
    private prisma: PrismaService,
    private ocrService: OcrService,
    private auditService: AuditService,
  ) {}

  /**
   * 获取批次日期（用于幂等键）
   */
  private getBatchDate(date?: Date): string {
    const d = date || new Date();
    return d.toISOString().split('T')[0]; // YYYY-MM-DD
  }

  /**
   * 添加 OCR 识别任务
   */
  async addOcrJob(shipmentId: string, imageUrl: string, imageBuffer: Buffer) {
    const batchDate = this.getBatchDate();
    const jobId = `label-ocr:${shipmentId}:${batchDate}`;
    await this.ocrQueue.add(
      'extract',
      { shipmentId, imageUrl, imageBuffer },
      {
        jobId,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 60000, // 1 minute
        },
      },
    );
  }

  /**
   * 处理 OCR 识别
   */
  async processExtract(job: any) {
    const { shipmentId, imageUrl, imageBuffer } = job.data;
    
    // OCR 识别
    const result = await this.ocrService.extractTrackingNumber(imageBuffer);

    // 创建 OCR 记录
    const trackingExtract = await this.prisma.trackingExtract.create({
      data: {
        shipmentId,
        imageUrl,
        trackingNo: result.trackingNo,
        carrier: result.carrier,
        confidence: result.confidence,
        method: result.method,
        rawText: result.rawText,
        autoFilled: result.confidence >= 0.85,
      },
    });

    // 如果置信度 >= 0.85，自动回填
    if (result.confidence >= 0.85 && result.trackingNo) {
      await this.prisma.shipment.update({
        where: { id: shipmentId },
        data: {
          trackingNo: result.trackingNo,
          carrier: result.carrier,
        },
      });

      await this.prisma.trackingExtract.update({
        where: { id: trackingExtract.id },
        data: {
          autoFilled: true,
          confirmedAt: new Date(),
        },
      });

      await this.auditService.log({
        action: 'ocr.autofill',
        resource: 'Shipment',
        resourceId: shipmentId,
        details: {
          trackingNo: result.trackingNo,
          confidence: result.confidence,
        },
      });
    }

    return trackingExtract;
  }
}

// 导出 Worker 处理器（用于 worker.ts）
export const ocrProcessors = {
  extract: async (job: any, ocrQueue: OcrQueue) => {
    await ocrQueue.processExtract(job);
  },
};

