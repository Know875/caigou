import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 日志已禁用，如需调试可取消注释
    // console.log(`[HTTP] ${req.method} ${req.originalUrl}`);
    next();
  }
}

