import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggerMiddleware } from './common/middleware/logger.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // 配置 HTTP 服务器选项，支持 keep-alive
    httpsOptions: undefined, // 不使用 HTTPS
  });

  // 获取底层 HTTP 服务器并配置 keep-alive
  const server = app.getHttpServer();
  server.keepAliveTimeout = 65000; // 65秒（略大于客户端超时）
  server.headersTimeout = 66000; // 66秒（略大于 keepAliveTimeout）

  // 全局日志中间件
  app.use(new LoggerMiddleware().use.bind(new LoggerMiddleware()));
  
  // 添加请求日志中间件（用于调试）
  app.use((req: any, res: any, next: any) => {
    console.log(`[HTTP] ${req.method} ${req.url}`, {
      origin: req.headers.origin,
      host: req.headers.host,
      'user-agent': req.headers['user-agent'],
      'content-type': req.headers['content-type'],
      timestamp: new Date().toISOString(),
    });
    next();
  });

  // CORS配置
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    // 生产环境：严格限制CORS
    const allowedOrigins = process.env.WEB_URL 
      ? [process.env.WEB_URL]
      : [];
    
    if (allowedOrigins.length === 0) {
      console.warn('⚠️ 生产环境未配置 WEB_URL，CORS将拒绝所有请求');
    }
    
    app.enableCors({
      origin: (origin, callback) => {
        // 生产环境不允许无origin的请求
        if (!origin) {
          callback(new Error('Not allowed by CORS: No origin'));
          return;
        }
        
        // 检查是否在允许列表中
        const isAllowed = allowedOrigins.some(allowed => {
          if (typeof allowed === 'string') {
            return origin === allowed;
          }
          return false;
        });
        
        if (isAllowed) {
          callback(null, true);
        } else {
          console.warn(`⚠️ CORS拒绝请求，来源: ${origin}`);
          callback(new Error('Not allowed by CORS'));
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
      exposedHeaders: ['Content-Type', 'Authorization'],
    });
  } else {
    // 开发环境：允许所有来源（包括局域网IP）
    const allowedOrigins = process.env.WEB_URL 
      ? [process.env.WEB_URL]
      : ['http://localhost:8080', /^http:\/\/192\.168\.\d+\.\d+:8080$/, /^http:\/\/10\.\d+\.\d+\.\d+:8080$/, /^http:\/\/172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+:8080$/];
    
    app.enableCors({
      origin: (origin, callback) => {
        // 允许无 origin 的请求（如移动应用）
        if (!origin) return callback(null, true);
        
        // 检查是否在允许列表中
        const isAllowed = allowedOrigins.some(allowed => {
          if (typeof allowed === 'string') {
            return origin === allowed;
          }
          if (allowed instanceof RegExp) {
            return allowed.test(origin);
          }
          return false;
        });
        
        if (isAllowed) {
          callback(null, true);
        } else {
          // 开发环境：允许所有来源
          callback(null, true);
        }
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
      exposedHeaders: ['Content-Type', 'Authorization'],
    });
  }

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false, // 改为 false，避免在开发环境过于严格
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global Interceptors
  app.useGlobalInterceptors(new TransformInterceptor());

  // Global Filters - 使用 AllExceptionsFilter 捕获所有异常
  app.useGlobalFilters(new AllExceptionsFilter());

  // API Prefix
  app.setGlobalPrefix('api');

  const port = process.env.API_PORT || 8081;

  // Swagger - 仅在非生产环境启用
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Egg Purchase System API')
      .setDescription('多门店模型玩具采购协同系统 API 文档')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document);
    console.log(`📚 Swagger docs at http://localhost:${port}/api/docs`);
  } else {
    console.log('📚 Swagger已禁用（生产环境）');
  }
  // 监听所有网络接口，允许外部访问
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 API Server running on http://0.0.0.0:${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // 获取本机 IP 地址（用于手机访问）
  const os = require('os');
  const networkInterfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    if (interfaces) {
      for (const iface of interfaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }
  }
  if (addresses.length > 0) {
    console.log(`📱 手机访问地址: http://${addresses[0]}:${port}`);
  }
}

bootstrap();

