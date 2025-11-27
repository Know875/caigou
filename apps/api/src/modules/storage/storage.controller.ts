import { Controller, Get, Param, Res, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('存储')
@Controller('storage')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StorageController {
  constructor(private storageService: StorageService) {}

  /**
   * 代理图片请求，解决 CORS 和 Private Network Access 问题
   * 通过后端 API 代理 MinIO 图片，避免浏览器直接访问 MinIO
   */
  @Get('file/:key(*)')
  @ApiOperation({ summary: '获取文件（代理 MinIO 请求）' })
  async getFile(
    @Param('key') key: string,
    @Res() res: Response,
    @Request() req,
  ) {
    try {
      // 从 MinIO 获取文件流
      const fileStream = await this.storageService.getFileStream(key);
      
      // 设置响应头
      res.setHeader('Content-Type', fileStream.ContentType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'public, max-age=3600'); // 缓存1小时
      
      // 如果文件有 ETag，设置 ETag 头
      if (fileStream.ETag) {
        res.setHeader('ETag', fileStream.ETag);
      }
      
      // 如果文件有 LastModified，设置 Last-Modified 头
      if (fileStream.LastModified) {
        res.setHeader('Last-Modified', fileStream.LastModified.toUTCString());
      }
      
      // 流式传输文件内容
      // AWS SDK v3 在 Node.js 中返回的 Body 是 Readable stream
      if (!fileStream.Body) {
        res.status(404).json({
          success: false,
          message: '文件内容为空',
        });
        return;
      }

      // 在 Node.js 环境中，Body 是 Readable stream，可以直接 pipe
      const body = fileStream.Body as any;
      if (body && typeof body.pipe === 'function') {
        // Readable stream，直接 pipe
        body.pipe(res);
      } else if (body instanceof Uint8Array) {
        // Uint8Array，转换为 Buffer
        res.send(Buffer.from(body));
      } else if (body instanceof Buffer) {
        // Buffer，直接发送
        res.send(body);
      } else {
        // 其他情况，尝试转换为 Buffer
        // 对于 ReadableStream (浏览器环境)，需要转换为 Buffer
        const chunks: Buffer[] = [];
        if (body && typeof body.getReader === 'function') {
          // 浏览器 ReadableStream
          const reader = body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(Buffer.from(value));
          }
          res.send(Buffer.concat(chunks));
        } else {
          // 尝试直接转换为 Buffer
          res.send(Buffer.from(body as unknown as ArrayBuffer));
        }
      }
    } catch (error) {
      console.error(`[StorageController] 获取文件失败: ${key}`, error);
      res.status(404).json({
        success: false,
        message: '文件不存在或无法访问',
      });
    }
  }
}

