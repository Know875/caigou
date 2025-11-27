import { plainToInstance } from 'class-transformer';
import { IsNotEmpty, IsString, IsOptional, IsNumber, Min, validateSync, IsUrl, MinLength } from 'class-validator';

class EnvironmentVariables {
  @IsNotEmpty()
  @IsString()
  DATABASE_URL: string;

  @IsNotEmpty()
  @IsString()
  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters long' })
  JWT_SECRET: string;

  @IsOptional()
  @IsString()
  REDIS_URL?: string;

  @IsOptional()
  @IsString()
  MINIO_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  MINIO_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  MINIO_SECRET_KEY?: string;

  @IsOptional()
  @IsString()
  S3_ENDPOINT?: string;

  @IsOptional()
  @IsString()
  DINGTALK_WEBHOOK_URL?: string;

  @IsOptional()
  @IsString()
  OCR_SPACE_API_KEY?: string;

  @IsOptional()
  @IsString()
  XFYUN_APP_ID?: string;

  @IsOptional()
  @IsString()
  XFYUN_API_KEY?: string;

  @IsOptional()
  @IsString()
  XFYUN_API_SECRET?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  API_PORT?: number;

  @IsOptional()
  @IsString()
  NODE_ENV?: string;

  @IsOptional()
  @IsString()
  WEB_URL?: string;
}

export function validate(config: Record<string, unknown>) {
  // 预处理：将字符串类型的数字转换为数字类型
  if (config.API_PORT && typeof config.API_PORT === 'string') {
    const port = parseInt(config.API_PORT, 10);
    if (!isNaN(port)) {
      config.API_PORT = port;
    }
  }
  
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });
  
  if (errors.length > 0) {
    const errorMessages = errors.map(error => {
      const constraints = Object.values(error.constraints || {}).join(', ');
      return `${error.property}: ${constraints}`;
    });
    throw new Error(`环境变量验证失败:\n${errorMessages.join('\n')}`);
  }
  
  return validatedConfig;
}

