import { Injectable, OnModuleInit, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, HeadBucketCommand, CreateBucketCommand, ListBucketsCommand, PutBucketPolicyCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import * as crypto from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3: S3Client;
  private bucket: string;
  private publicEndpoint: string; // 用于生成签名 URL 的公共访问地址
  private publicS3: S3Client | null = null; // 用于生成公共签名 URL 的 S3 客户端
  private accessKeyId: string;
  private secretAccessKey: string;

  constructor(@Optional() private configService?: ConfigService) {
    // 优先从 process.env 读取，避免 ConfigService 配置问题
    // 同时检查 MINIO_ENDPOINT（兼容旧配置）和 S3_ENDPOINT
    const envEndpoint = process.env.S3_ENDPOINT || process.env.MINIO_ENDPOINT;
    const configEndpoint = this.configService?.get<string>('S3_ENDPOINT') || this.configService?.get<string>('MINIO_ENDPOINT');
    let endpoint = envEndpoint || configEndpoint || 'http://localhost:9000';
    
    // 自动纠正端口错误：如果配置的是 9001（控制台端口），自动改为 9000（API 端口）
    if (endpoint.includes(':9001')) {
      this.logger.warn(`⚠️ 检测到 MinIO 端点配置为 9001 端口（控制台端口），自动纠正为 9000 端口（API 端口）`);
      endpoint = endpoint.replace(':9001', ':9000');
    }
    
    // 确保 endpoint 格式正确
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `http://${endpoint}`;
    }
    
    // 获取 MinIO 的公共访问地址（用于生成签名 URL）
    // 如果前端通过局域网 IP 访问，需要使用相同的 IP 地址
    // 优先使用环境变量 MINIO_PUBLIC_ENDPOINT，如果没有则尝试自动检测
    const configPublicEndpoint = this.configService?.get<string>('MINIO_PUBLIC_ENDPOINT');
    const envPublicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT;
    
    // 如果没有设置公共地址，且内部地址是 localhost，尝试自动检测局域网 IP
    let publicEndpoint = envPublicEndpoint || configPublicEndpoint;
    if (!publicEndpoint && endpoint.includes('localhost')) {
      // 尝试从 API_PORT 或其他环境变量推断，或者使用常见的局域网 IP 模式
      // 这里我们使用一个简单的策略：如果 endpoint 是 localhost，保持为 localhost
      // 但实际使用时会在 getSignedUrl 中动态替换
      publicEndpoint = endpoint;
    } else if (!publicEndpoint) {
      publicEndpoint = endpoint;
    }
    
    this.publicEndpoint = publicEndpoint;
    
    // 记录详细的配置信息，帮助调试
    this.logger.log('MinIO 配置信息', {
      internalEndpoint: endpoint,
      publicEndpoint: this.publicEndpoint,
      envS3Endpoint: process.env.S3_ENDPOINT || '未设置',
      envMinioEndpoint: process.env.MINIO_ENDPOINT || '未设置',
      configS3Endpoint: this.configService?.get<string>('S3_ENDPOINT') || '未设置',
      configMinioEndpoint: this.configService?.get<string>('MINIO_ENDPOINT') || '未设置',
      envPublicEndpoint: envPublicEndpoint || '未设置',
      configPublicEndpoint: configPublicEndpoint || '未设置',
    });
    
    // 直接从 process.env 读取，避免 ConfigService 的问题
    // 同时检查 ConfigService 的值，用于对比
    const envAccessKey = process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER;
    const envSecretKey = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD;
    const configAccessKey = this.configService?.get<string>('MINIO_ACCESS_KEY') || this.configService?.get<string>('MINIO_ROOT_USER');
    const configSecretKey = this.configService?.get<string>('MINIO_SECRET_KEY') || this.configService?.get<string>('MINIO_ROOT_PASSWORD');
    
    // 优先使用 process.env，如果不存在则使用 ConfigService，最后使用默认值
    // 诊断脚本已确认 minioadmin/minioadmin 可以工作，所以使用它作为默认值
    const accessKeyId = (envAccessKey || configAccessKey || 'minioadmin').trim();
    const secretAccessKey = (envSecretKey || configSecretKey || 'minioadmin').trim();
    
    // 确保值不为空，如果为空则使用默认值
    const finalAccessKeyId = accessKeyId || 'minioadmin';
    const finalSecretAccessKey = secretAccessKey || 'minioadmin';
    
    // 保存凭证供后续使用
    this.accessKeyId = finalAccessKeyId;
    this.secretAccessKey = finalSecretAccessKey;
    
    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('MinIO 配置信息', {
        endpoint,
        accessKey: finalAccessKeyId,
        secretKeySet: !!finalSecretAccessKey,
        secretKeyLength: finalSecretAccessKey ? finalSecretAccessKey.length : 0,
        bucket: this.bucket,
        envAccessKey: process.env.MINIO_ACCESS_KEY || '未设置',
        envSecretKey: process.env.MINIO_SECRET_KEY ? '已设置' : '未设置',
        envRootUser: process.env.MINIO_ROOT_USER || '未设置',
        envRootPassword: process.env.MINIO_ROOT_PASSWORD ? '已设置' : '未设置',
        configAccessKey: configAccessKey || '未设置',
        configSecretKey: configSecretKey ? '已设置' : '未设置',
      });
    }
    
    if (!finalAccessKeyId || !finalSecretAccessKey) {
      this.logger.error('MinIO 凭证未设置！请设置 MINIO_ACCESS_KEY/MINIO_SECRET_KEY 或 MINIO_ROOT_USER/MINIO_ROOT_PASSWORD');
    }
    
    // 直接使用 accessKeyId 和 secretAccessKey，而不是 credentials 对象
    // 这样可以避免异步加载问题，并且与测试脚本保持一致
    this.logger.debug('创建 S3 客户端', {
      accessKeyPrefix: finalAccessKeyId.substring(0, Math.min(4, finalAccessKeyId.length)),
    });
    
    // AWS SDK v3 配置
    this.s3 = new S3Client({
      endpoint,
      region: 'us-east-1', // MinIO 需要设置 region，但不会实际使用
      credentials: {
      accessKeyId: finalAccessKeyId,
      secretAccessKey: finalSecretAccessKey,
      },
      forcePathStyle: true, // MinIO 需要路径样式
    });
    // 使用不包含连字符的 bucket 名称，避免 MinIO 验证错误
    // egg-purchase 包含连字符，MinIO 可能认为无效，使用 eggpurchase
    // 同时去除首尾空格，避免配置错误
    const bucketFromEnv = this.configService?.get<string>('MINIO_BUCKET');
    this.bucket = (bucketFromEnv ? bucketFromEnv.trim() : 'eggpurchase').replace(/[^a-z0-9.-]/g, '');
    
    // 如果 bucket 名称包含连字符，替换为无连字符版本
    if (this.bucket.includes('-')) {
      this.bucket = this.bucket.replace(/-/g, '');
    }
    
    this.logger.debug('使用 bucket', { bucket: this.bucket });
  }

  async onModuleInit() {
    // 初始化时确保存储桶存在
    try {
      await this.ensureBucketExists();
      // 测试连接：尝试列出 buckets
      const command = new ListBucketsCommand({});
      const response = await this.s3.send(command);
      this.logger.log('MinIO 连接测试成功', { bucketsCount: response.Buckets?.length || 0 });
    } catch (error: any) {
      const errorCode = error.name || error.Code || error.code;
      const errorMessage = error.message || 'Unknown error';
      const statusCode = error.$metadata?.httpStatusCode || error.statusCode;
      
      this.logger.error('MinIO 初始化失败', {
        code: errorCode,
        message: errorMessage,
        statusCode,
      });
      
      if (errorCode === 'NetworkingError' || errorCode === 'ECONNREFUSED' || errorMessage?.includes('connect')) {
        this.logger.error('MinIO 服务未运行或无法连接！请检查：1. MinIO 服务是否已启动（端口 9000）2. 运行: .\\start-minio.ps1 启动 MinIO 3. 或手动启动 MinIO 服务 4. 检查防火墙设置');
      } else if (errorCode === 'UnknownEndpoint' || errorMessage?.includes('Inaccessible host')) {
        this.logger.error('MinIO 端点无法访问！请检查：1. S3_ENDPOINT 配置是否正确（应该是 http://localhost:9000）2. MinIO 服务是否在端口 9000 运行 3. 检查端点地址是否正确', {
          configuredEndpoint: this.configService?.get<string>('S3_ENDPOINT') || '未设置',
        });
      } else if (errorCode === 'InvalidAccessKeyId' || errorMessage?.includes('Access Key')) {
        this.logger.error('凭证错误！请检查环境变量 MINIO_ACCESS_KEY 和 MINIO_SECRET_KEY，确保与 MinIO 启动时使用的凭证一致', {
          accessKey: process.env.MINIO_ACCESS_KEY || '未设置',
          secretKeySet: !!process.env.MINIO_SECRET_KEY,
        });
      } else {
        this.logger.error('未知错误，请检查 MinIO 配置', {
          errorCode,
          errorMessage,
        });
      }
      
      // 不抛出错误，允许服务启动，但会在上传时失败
      // 这样即使 MinIO 未运行，API 服务也可以正常启动（除了文件上传功能）
      this.logger.warn('文件上传功能将不可用，但 API 服务可以继续运行');
    }
  }

  private async ensureBucketExists(): Promise<void> {
    // 验证 bucket 名称格式（基本检查）
    if (!this.bucket || this.bucket.length < 3 || this.bucket.length > 63) {
      this.logger.error('Invalid bucket name', { bucket: this.bucket });
      throw new Error(`Invalid bucket name: ${this.bucket}`);
    }

    try {
      // 检查存储桶是否存在
      const headCommand = new HeadBucketCommand({ Bucket: this.bucket });
      await this.s3.send(headCommand);
      this.logger.debug('MinIO bucket exists', { bucket: this.bucket });
    } catch (error: any) {
      const statusCode = error.$metadata?.httpStatusCode || error.statusCode;
      const errorCode = error.name || error.Code || error.code;
      
      if (statusCode === 404 || errorCode === 'NotFound' || errorCode === 'NoSuchBucket') {
        // 存储桶不存在，创建它
        try {
          const createCommand = new CreateBucketCommand({ Bucket: this.bucket });
          await this.s3.send(createCommand);
          this.logger.log('Created MinIO bucket', { bucket: this.bucket });
        } catch (createError: any) {
          const createStatusCode = createError.$metadata?.httpStatusCode || createError.statusCode;
          const createErrorCode = createError.name || createError.Code || createError.code;
          this.logger.error('Failed to create bucket', {
            bucket: this.bucket,
            message: createError.message,
            code: createErrorCode,
            statusCode: createStatusCode,
          });
          // 如果是连接错误，可能是 MinIO 未运行，只记录警告
          if (createErrorCode === 'ECONNREFUSED' || createErrorCode === 'ENOTFOUND') {
            this.logger.warn('MinIO may not be running');
          } else if (createErrorCode === 'InvalidBucketName') {
            this.logger.error('Bucket name is invalid', { bucket: this.bucket });
          }
        }
      } else if (errorCode === 'InvalidBucketName' || error.message?.includes('bucket is not valid')) {
        this.logger.error('Bucket name is invalid', {
          bucket: this.bucket,
          length: this.bucket.length,
        });
        // 尝试使用一个有效的默认 bucket 名称（不使用连字符）
        const fallbackBucket = 'eggpurchase';
        if (this.bucket !== fallbackBucket) {
          this.logger.warn('Attempting to use fallback bucket name', { fallbackBucket });
          this.bucket = fallbackBucket;
          try {
            const headCommand = new HeadBucketCommand({ Bucket: this.bucket });
            await this.s3.send(headCommand);
            this.logger.debug('Fallback bucket exists', { bucket: this.bucket });
          } catch (fallbackError: any) {
            const fallbackStatusCode = fallbackError.$metadata?.httpStatusCode || fallbackError.statusCode;
            const fallbackErrorCode = fallbackError.name || fallbackError.Code || fallbackError.code;
            if (fallbackStatusCode === 404 || fallbackErrorCode === 'NotFound' || fallbackErrorCode === 'NoSuchBucket') {
              try {
                const createCommand = new CreateBucketCommand({ Bucket: this.bucket });
                await this.s3.send(createCommand);
                this.logger.log('Created fallback bucket', { bucket: this.bucket });
              } catch (createError: any) {
                const createStatusCode = createError.$metadata?.httpStatusCode || createError.statusCode;
                const createErrorCode = createError.name || createError.Code || createError.code;
                this.logger.error('Failed to create fallback bucket', {
                  bucket: this.bucket,
                  message: createError.message,
                  code: createErrorCode,
                  statusCode: createStatusCode,
                });
                throw createError;
              }
            } else if (fallbackErrorCode === 'InvalidBucketName') {
              this.logger.error('Fallback bucket name is also invalid. Please configure a valid MINIO_BUCKET');
              throw fallbackError;
            } else {
              this.logger.error('Fallback bucket check failed', {
                message: fallbackError.message,
                code: fallbackErrorCode,
                statusCode: fallbackStatusCode,
              });
              throw fallbackError;
            }
          }
        } else {
          // 已经是备用 bucket 了，仍然无效
          this.logger.error('Fallback bucket name is also invalid. Please configure a valid MINIO_BUCKET');
          throw error;
        }
      } else if (errorCode === 'InvalidAccessKeyId' || errorCode === 'CredentialsError' || error.message?.includes('Missing credentials') || error.message?.includes('does not exist in our records')) {
        this.logger.error('MinIO 访问凭证错误', {
          message: error.message || errorCode,
          accessKeyId: this.accessKeyId || '未设置',
        });
        this.logger.warn('请检查 MinIO 服务是否正在运行，以及凭证配置是否正确。默认凭证应该是: minioadmin/minioadmin');
      } else if (errorCode === 'ECONNREFUSED' || errorCode === 'ENOTFOUND') {
        this.logger.warn('Cannot connect to MinIO');
        this.logger.warn('File uploads will fail until MinIO is available');
      } else {
        this.logger.error('Error checking bucket', {
          bucket: this.bucket,
          message: error.message,
          code: errorCode,
          statusCode,
        });
      }
    }
  }

  private isValidBucketName(name: string): boolean {
    // S3 bucket 名称规则（宽松验证，让 MinIO 自己验证）：
    // 1. 长度 3-63 字符
    // 2. 只能包含小写字母、数字、连字符(-)和点(.)
    // 3. 必须以字母或数字开头和结尾
    // 4. 不能包含两个相邻的点
    // 5. 不能是 IP 地址格式
    if (!name || name.length < 3 || name.length > 63) {
      return false;
    }
    // 只做基本检查，让 MinIO 自己验证详细规则
    if (!/^[a-z0-9]/.test(name) || !/[a-z0-9]$/.test(name)) {
      return false;
    }
    // 允许连字符和点
    if (!/^[a-z0-9.-]+$/.test(name)) {
      return false;
    }
    if (name.includes('..')) {
      return false;
    }
    // 检查是否是 IP 地址格式
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) {
      return false;
    }
    return true;
  }

  /**
   * 生成文件水印 hash（用于文件完整性验证）
   */
  private generateFileHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  async uploadFile(file: Express.Multer.File, folder: string = ''): Promise<string> {
    // 确保存储桶存在（如果失败会尝试切换到备用 bucket）
    // 注意：不调用 ensureBucketIsPrivate，因为 MinIO 默认是私有的，且设置策略可能导致凭证问题
    try {
      await this.ensureBucketExists();
      // 不调用 ensureBucketIsPrivate，MinIO 默认是私有的
    } catch (error: any) {
      // 如果 bucket 名称无效，尝试使用备用 bucket
      if (error.message?.includes('Invalid bucket name') || error.code === 'InvalidBucketName') {
        this.logger.warn('Original bucket name invalid, switching to fallback', { fallbackBucket: 'eggpurchase' });
        this.bucket = 'eggpurchase';
        await this.ensureBucketExists();
        // 不调用 ensureBucketIsPrivate
      } else {
        throw error;
      }
    }
    
    // 生成文件 hash（水印）
    const fileHash = this.generateFileHash(file.buffer);
    // 清理文件名，移除特殊字符，避免签名问题
    // 将中文字符和其他特殊字符替换为安全的字符
    const safeFileName = file.originalname
      .replace(/[^\w\-_\.]/g, '_') // 只保留字母、数字、连字符、下划线和点
      .replace(/_{2,}/g, '_') // 将多个下划线替换为单个
      .substring(0, 100); // 限制文件名长度
    const fileName = `${folder}/${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeFileName}`;
    
    this.logger.debug('上传文件', {
      originalName: file.originalname,
      safeFileName: safeFileName,
      finalFileName: fileName,
      fileSize: file.buffer.length,
      contentType: file.mimetype,
    });
    
    // 在文件元数据中存储 hash
    // 注意：metadata 值必须是 ASCII 字符串，不能包含特殊字符
    const metadata: Record<string, string> = {
      'file-hash': fileHash,
      'original-name': Buffer.from(file.originalname, 'utf8').toString('base64'), // 使用 base64 编码避免特殊字符问题
      'upload-time': new Date().toISOString(),
    };
    
    try {
      // 移除 ACL 设置，因为某些 MinIO 版本不支持 ACL，会导致签名错误
      // 确保使用正确的凭证（从构造函数中获取的值）
      this.logger.debug('开始上传到 MinIO', {
        bucket: this.bucket,
        key: fileName,
        accessKeyId: this.accessKeyId?.substring(0, 4) + '...',
      });
      
      const putCommand = new PutObjectCommand({
        Bucket: this.bucket,
        Key: fileName,
        Body: file.buffer,
        ContentType: file.mimetype,
        Metadata: metadata,
        // 不设置 ACL，MinIO 默认是私有的
      });
      await this.s3.send(putCommand);
      
      this.logger.log('文件上传成功', { fileName });
    } catch (error: any) {
      this.logger.error('上传文件失败', {
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        bucket: this.bucket,
        fileName: fileName,
      });
      
      // 如果上传失败且是因为 bucket 名称无效，尝试使用备用 bucket
      if (error.code === 'InvalidBucketName' && this.bucket !== 'eggpurchase') {
        this.logger.warn('Bucket name invalid during upload, switching to fallback', { fallbackBucket: 'eggpurchase' });
        const oldBucket = this.bucket;
        this.bucket = 'eggpurchase';
        
        // 确保备用 bucket 存在（但不设置策略，避免凭证问题）
        try {
          const headCommand = new HeadBucketCommand({ Bucket: this.bucket });
          await this.s3.send(headCommand);
          this.logger.debug('Fallback bucket exists', { bucket: this.bucket });
        } catch (headError: any) {
          const headStatusCode = headError.$metadata?.httpStatusCode || headError.statusCode;
          const headErrorCode = headError.name || headError.Code || headError.code;
          if (headStatusCode === 404 || headErrorCode === 'NotFound' || headErrorCode === 'NoSuchBucket') {
            try {
              // 创建 bucket 时不要设置任何策略，避免凭证问题
              const createCommand = new CreateBucketCommand({ Bucket: this.bucket });
              await this.s3.send(createCommand);
              this.logger.log('Created fallback bucket', { bucket: this.bucket });
            } catch (createError: any) {
              const createStatusCode = createError.$metadata?.httpStatusCode || createError.statusCode;
              const createErrorCode = createError.name || createError.Code || createError.code;
              this.logger.error('Failed to create fallback bucket', {
                code: createErrorCode,
                message: createError.message,
                statusCode: createStatusCode,
              });
              // 恢复原来的 bucket 名称
              this.bucket = oldBucket;
              throw createError;
            }
          } else if (headStatusCode === 403 || headErrorCode === 'Forbidden' || headError.message?.includes('Access Key')) {
            // 如果是凭证错误，不要切换 bucket，直接抛出错误
            this.logger.error('凭证错误，无法访问 bucket', {
              code: headErrorCode,
              message: headError.message,
              statusCode: headStatusCode,
            });
            this.bucket = oldBucket;
            throw new Error(`MinIO 凭证错误：无法访问 bucket。请检查 MINIO_ACCESS_KEY 和 MINIO_SECRET_KEY 是否正确。`);
          } else {
            // 恢复原来的 bucket 名称
            this.bucket = oldBucket;
            throw headError;
          }
        }
        
        // 重试上传（不设置 ACL）
        try {
          const putCommand = new PutObjectCommand({
            Bucket: this.bucket,
            Key: fileName,
            Body: file.buffer,
            ContentType: file.mimetype,
            Metadata: metadata,
            // 不设置 ACL
          });
          await this.s3.send(putCommand);
          this.logger.log('文件已上传到备用 bucket', { bucket: this.bucket });
        } catch (retryError: any) {
          // 如果重试也失败，恢复原来的 bucket 名称
          this.bucket = oldBucket;
          throw retryError;
        }
      } else {
        // 如果是签名错误，提供更详细的错误信息和解决方案
        const errorCode = error.name || error.Code || error.code;
        const statusCode = error.$metadata?.httpStatusCode || error.statusCode;
        if (errorCode === 'SignatureDoesNotMatch' || error.message?.includes('signature') || statusCode === 403) {
          this.logger.error('MinIO 签名错误（403 Forbidden）', {
            accessKeyId: this.accessKeyId || '未设置',
            message: '可能的原因：1. MinIO 服务未运行（检查 http://localhost:9001）2. MinIO 凭证不匹配 3. MinIO 端点配置错误',
          });
          
          // 抛出更友好的错误信息
          throw new Error(`MinIO 上传失败：签名错误。请检查 MinIO 服务是否运行，以及凭证是否正确配置。详细信息请查看服务器日志。`);
        }
        throw error;
      }
    }

    // 返回可访问的 URL（使用短期签名 URL，默认1小时有效期）
    const signedUrl = await this.getSignedUrl(fileName, 3600); // 1小时有效期（更安全）
    return signedUrl;
  }

  /**
   * 确保存储桶是私有的（不允许公共访问）
   */
  private async ensureBucketIsPrivate(): Promise<void> {
    try {
      // 设置存储桶策略为私有（不允许公共访问）
      // MinIO/S3 默认是私有的，但我们可以显式设置
      // 注意：MinIO 可能不支持 PutBucketPolicy，如果失败则忽略
      try {
        const policy = {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Deny',
              Principal: '*',
              Action: 's3:GetObject',
              Resource: `arn:aws:s3:::${this.bucket}/*`,
              Condition: {
                Bool: {
                  'aws:PublicAccess': 'true',
                },
              },
            },
          ],
        };
        const putPolicyCommand = new PutBucketPolicyCommand({
          Bucket: this.bucket,
          Policy: JSON.stringify(policy),
        });
        await this.s3.send(putPolicyCommand);
      } catch (policyError: any) {
        // MinIO 可能不支持 PutBucketPolicy，忽略错误
        // 默认情况下 MinIO 存储桶是私有的
        if (policyError.code !== 'NotImplemented' && policyError.code !== 'InvalidArgument') {
          this.logger.warn('Failed to set bucket policy (this is OK for MinIO)', { message: policyError.message });
        }
      }
    } catch (error: any) {
      // 忽略错误，MinIO 默认是私有的
      this.logger.warn('Could not ensure bucket is private (this is OK)', { message: error.message });
    }
  }

  /**
   * 获取文件的完整 URL（用于前端显示）
   * 使用短期签名 URL 确保安全
   */
  async getFileUrl(key: string, expiresIn: number = 3600, requestOrigin?: string): Promise<string> {
    // 如果已经是完整 URL，需要从 URL 中提取 key 并重新生成签名 URL
    if (key.startsWith('http://') || key.startsWith('https://')) {
      try {
        const url = new URL(key);
        // 从 pathname 中提取 key（移除 bucket 名称）
        // pathname 格式：/bucket-name/file-path 或 /eggpurchase/shipment-photos/...
        let keyFromUrl = url.pathname.substring(1); // 移除前导斜杠
        
        // 如果 key 以 bucket 名称开头，移除它
        if (keyFromUrl.startsWith(this.bucket + '/')) {
          keyFromUrl = keyFromUrl.substring(this.bucket.length + 1); // 移除 bucket 名称和斜杠
        }
        
        if (keyFromUrl) {
          this.logger.debug('从 URL 提取 key', { originalKey: key, extractedKey: keyFromUrl });
          return this.getSignedUrl(keyFromUrl, expiresIn, requestOrigin);
        }
      } catch (error) {
        this.logger.error('URL 解析失败', { key, error });
        // URL 解析失败，返回原 URL
      }
      return key;
    }
    // 否则生成短期签名 URL（默认1小时）
    return this.getSignedUrl(key, expiresIn, requestOrigin);
  }

  /**
   * 生成签名 URL（短期有效，确保安全）
   */
  async getSignedUrl(key: string, expiresIn: number = 3600, requestOrigin?: string): Promise<string> {
    // 默认1小时有效期，最大不超过7天
    const maxExpires = 7 * 24 * 3600; // 7天
    const finalExpires = Math.min(expiresIn, maxExpires);
    
    // 获取内部 endpoint（从 S3Client 配置中提取）
    const internalEndpoint = (this.s3.config as any).endpoint?.toString() || this.publicEndpoint;
    let targetEndpoint = this.publicEndpoint;
    
    // 优先从请求头中提取 IP（如果提供了 requestOrigin）
    // 这样可以确保生成的签名 URL 使用与前端相同的 IP 地址，避免 CORS 和 Private Network Access 问题
    let detectedIP: string | null = null;
    
    if (requestOrigin) {
      try {
        const originUrl = new URL(requestOrigin);
        const hostname = originUrl.hostname;
        // 如果是 IP 地址（不是 localhost），优先使用它
        if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1') {
          detectedIP = hostname;
          this.logger.debug('从请求头提取 IP', { detectedIP });
        }
      } catch (error) {
        this.logger.warn('无法解析请求头 Origin', { requestOrigin, error });
      }
    }
    
    // 如果从请求头获取到 IP，优先使用它（解决 CORS 问题）
    if (detectedIP) {
      targetEndpoint = `http://${detectedIP}:9000`;
      this.logger.debug('使用请求头中的 IP 生成签名 URL', { targetEndpoint });
    } else if (targetEndpoint.includes('localhost')) {
      // 如果公共地址是 localhost，尝试从环境变量获取
      detectedIP = process.env.MINIO_PUBLIC_IP || null;
      
      // 如果还是无法获取，尝试从 MINIO_PUBLIC_ENDPOINT 中提取
      if (!detectedIP && this.publicEndpoint && !this.publicEndpoint.includes('localhost')) {
        try {
          const publicUrl = new URL(this.publicEndpoint);
          detectedIP = publicUrl.hostname;
        } catch (error) {
          // 忽略错误
        }
      }
      
      // 如果检测到 IP，使用它来生成签名 URL
      if (detectedIP) {
        targetEndpoint = `http://${detectedIP}:9000`;
        this.logger.debug('使用环境变量中的 IP 生成签名 URL', { targetEndpoint });
      } else {
        // 如果仍然是 localhost 且无法检测，使用默认值
        this.logger.warn('无法自动检测 IP，使用默认值 26.26.26.1。请设置 MINIO_PUBLIC_ENDPOINT 或 MINIO_PUBLIC_IP 环境变量');
        detectedIP = '26.26.26.1';
        targetEndpoint = `http://${detectedIP}:9000`;
      }
    }
    
    // 如果目标 endpoint 与内部 endpoint 不同，使用公共 S3 客户端生成签名 URL
    if (targetEndpoint !== internalEndpoint) {
      // 如果公共 S3 客户端不存在或 endpoint 不匹配，创建一个
      if (!this.publicS3) {
        this.publicS3 = new S3Client({
          endpoint: targetEndpoint,
          region: 'us-east-1',
          credentials: {
            accessKeyId: this.accessKeyId,
            secretAccessKey: this.secretAccessKey,
          },
          forcePathStyle: true,
        });
        this.logger.debug('创建公共 S3 客户端', { endpoint: targetEndpoint });
      }
      
      // 使用公共 S3 客户端生成签名 URL
      const getObjectCommand = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const signedUrl = await getSignedUrl(this.publicS3, getObjectCommand, { expiresIn: finalExpires });
      
      this.logger.debug('使用公共 endpoint 生成签名 URL', { targetEndpoint });
      return signedUrl;
    }
    
    // 否则使用内部 S3 客户端生成签名 URL
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const signedUrl = await getSignedUrl(this.s3, getObjectCommand, { expiresIn: finalExpires });
    
    this.logger.debug('使用内部 endpoint 生成签名 URL', { internalEndpoint });
    return signedUrl;
  }

  /**
   * 验证文件 hash（用于文件完整性验证）
   */
  async verifyFileHash(key: string, expectedHash: string): Promise<boolean> {
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const object = await this.s3.send(headCommand);
      
      const fileHash = object.Metadata?.['file-hash'];
      return fileHash === expectedHash;
      } catch (error) {
        this.logger.error('Failed to verify file hash', { key, error });
        return false;
      }
  }

  /**
   * 获取文件流（用于代理请求）
   */
  async getFileStream(key: string) {
    // 如果 key 是完整 URL，提取 key
    let fileKey = key;
    if (key.startsWith('http://') || key.startsWith('https://')) {
      try {
        const url = new URL(key);
        let keyFromUrl = url.pathname.substring(1);
        if (keyFromUrl.startsWith(this.bucket + '/')) {
          keyFromUrl = keyFromUrl.substring(this.bucket.length + 1);
        }
        fileKey = keyFromUrl;
      } catch (error) {
        this.logger.warn('无法从 URL 提取 key', { key, error });
      }
    }
    
    const getObjectCommand = new GetObjectCommand({
      Bucket: this.bucket,
      Key: fileKey,
    });
    return this.s3.send(getObjectCommand);
  }

  async deleteFile(key: string): Promise<void> {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    await this.s3.send(deleteCommand);
  }
}

