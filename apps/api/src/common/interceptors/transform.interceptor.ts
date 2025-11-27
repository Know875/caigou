import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 统一 API 响应格式拦截器
 */
export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(context: ExecutionContext, next: CallHandler): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        // 如果数据已经是统一格式，直接返回
        if (data && typeof data === 'object' && 'success' in data) {
          return data as ApiResponse<T>;
        }
        
        // 否则包装成统一格式
        return {
          success: true,
          data,
        };
      }),
    );
  }
}
