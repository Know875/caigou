import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // 如果是 HttpException，使用其状态码和消息
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || exception.message;

      this.logger.error(`HTTP Exception: ${status}`, {
        path: request.url,
        method: request.method,
        message: Array.isArray(message) ? message : [message],
        statusCode: status,
      });

      // 统一消息格式：如果是数组，取第一个；否则直接使用字符串
      const finalMessage = Array.isArray(message) ? message[0] : message;
      
      return response.status(status).json({
        success: false,
        statusCode: status,
        timestamp: new Date().toISOString(),
        path: request.url,
        message: finalMessage,
      });
    }

    // 处理未知错误
    let errorMessage: string;
    if (exception instanceof Error) {
      // 如果 message 是 null 或 undefined，使用错误类型或默认消息
      errorMessage = exception.message || exception.name || 'Unknown error';
    } else if (exception instanceof AggregateError) {
      // 处理 AggregateError（如 ECONNREFUSED）
      errorMessage = exception.message || 'Connection error';
      // 检查错误原因中是否包含连接错误
      if (exception.errors && exception.errors.length > 0) {
        const firstError = exception.errors[0];
        if (firstError instanceof Error) {
          errorMessage = firstError.message || errorMessage;
        } else {
          errorMessage = String(firstError) || errorMessage;
        }
      }
    } else {
      errorMessage = String(exception || 'Unknown error');
    }
    
    const errorStack =
      exception instanceof Error ? exception.stack : undefined;

    // 记录详细错误信息
    this.logger.error('Unhandled Exception', {
      path: request.url,
      method: request.method,
      error: errorMessage,
      stack: errorStack,
      errorType: exception?.constructor?.name,
      body: request.body,
      query: request.query,
      params: request.params,
    });

    // 根据错误类型提供更友好的错误消息
    let userMessage = '服务器内部错误，请稍后重试';
    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;

    // 确保 errorMessage 是字符串后再调用 includes
    const errorMessageStr = String(errorMessage || '');
    
    if (errorMessageStr.includes('ECONNREFUSED') || errorMessageStr.includes('connect') || errorMessageStr.includes('Connection')) {
      userMessage = '无法连接到数据库或外部服务，请检查服务状态';
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
    } else if (errorMessageStr.includes('timeout')) {
      userMessage = '请求超时，请稍后重试';
      statusCode = HttpStatus.REQUEST_TIMEOUT;
    } else if (errorMessageStr.includes('Prisma') || errorMessageStr.includes('database')) {
      userMessage = '数据库操作失败，请检查数据库连接和配置';
      statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    } else if (errorMessageStr.includes('Redis') || errorMessageStr.includes('redis')) {
      userMessage = '缓存服务不可用，请检查 Redis 连接';
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
    } else if (errorMessageStr.includes('MinIO') || errorMessageStr.includes('S3') || errorMessageStr.includes('NetworkingError')) {
      userMessage = '文件存储服务不可用，请检查 MinIO 连接。请确保 MinIO 服务正在运行（端口 9000）';
      statusCode = HttpStatus.SERVICE_UNAVAILABLE;
    }

    // 开发环境返回详细错误信息，生产环境返回通用错误信息
    const isDevelopment = process.env.NODE_ENV !== 'production';

    response.status(statusCode).json({
      success: false,
      statusCode,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: isDevelopment
        ? [userMessage, errorMessageStr].filter(Boolean)
        : [userMessage],
      ...(isDevelopment && errorStack
        ? { stack: errorStack.split('\n').slice(0, 10) }
        : {}),
    });
  }
}

