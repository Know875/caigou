import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as sharp from 'sharp';
import * as QRCode from 'qrcode';
import jsQR from 'jsqr';
import * as crypto from 'crypto';
import * as WebSocket from 'ws';
import * as https from 'https';
import * as http from 'http';
import * as FormData from 'form-data';
import axios from 'axios';

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);
  private xfyunAppId: string;
  private xfyunApiSecret: string;
  private xfyunApiKey: string;
  private xfyunOcrUrl = 'wss://ws-api.xfyun.cn/v2/ocr';
  
  // OCR.space API 配置
  private ocrSpaceApiKey: string;
  private ocrSpaceApiUrl = 'https://api.ocr.space/parse/image';

  constructor(@Optional() private configService?: ConfigService) {
    // 从环境变量或配置中获取讯飞 OCR 认证信息（保留作为备用）
    // 优先使用 ConfigService，如果不可用则使用 process.env，最后使用默认值
    this.xfyunAppId = this.configService?.get<string>('XFYUN_APP_ID') || process.env.XFYUN_APP_ID || 'e5090a9d';
    this.xfyunApiSecret = this.configService?.get<string>('XFYUN_API_SECRET') || process.env.XFYUN_API_SECRET || 'ZTFkMWVmZWIwMmY3MGNiMTRmOGMyZGRh';
    this.xfyunApiKey = this.configService?.get<string>('XFYUN_API_KEY') || process.env.XFYUN_API_KEY || '76faa70774cf22d1a048f940786fd301';
    
    // 检查是否使用默认值（可能无效）
    const isUsingDefaultXfyun = 
      this.xfyunAppId === 'e5090a9d' ||
      this.xfyunApiKey === '76faa70774cf22d1a048f940786fd301' ||
      this.xfyunApiSecret === 'ZTFkMWVmZWIwMmY3MGNiMTRmOGMyZGRh';
    
    if (isUsingDefaultXfyun) {
      this.logger.warn('⚠️ 讯飞 OCR 使用默认凭证，可能无效', {
        suggestion: '请配置有效的 XFYUN_APP_ID、XFYUN_API_KEY、XFYUN_API_SECRET 环境变量',
        registerUrl: 'https://www.xfyun.cn/',
        currentAppId: this.xfyunAppId.substring(0, 5) + '...',
      });
    } else {
      this.logger.log('✅ 讯飞 OCR 凭证已配置', {
        appIdPreview: this.xfyunAppId.substring(0, 5) + '...',
      });
    }
    
    // OCR.space API Key
    // 优先使用环境变量，如果没有配置则使用默认值
    // 如果之前一直正常工作，请确保环境变量 OCR_SPACE_API_KEY 已正确配置
    this.ocrSpaceApiKey = this.configService?.get<string>('OCR_SPACE_API_KEY') || process.env.OCR_SPACE_API_KEY || 'K84724218688957';
    
    // 检查是否从环境变量加载（环境变量优先于默认值）
    const fromEnv = !!(this.configService?.get<string>('OCR_SPACE_API_KEY') || process.env.OCR_SPACE_API_KEY);
    
    if (fromEnv) {
      this.logger.log('✅ OCR.space API Key 已从环境变量加载', {
        keyPreview: this.ocrSpaceApiKey.substring(0, 5) + '...',
      });
    } else {
      this.logger.warn('⚠️ OCR.space API Key 使用代码默认值，建议配置环境变量', {
        suggestion: '请在 .env.local 文件中配置 OCR_SPACE_API_KEY 环境变量',
        registerUrl: 'https://ocr.space/ocrapi',
        currentKey: this.ocrSpaceApiKey.substring(0, 5) + '...',
      });
    }
  }

  /**
   * 从快递面单图片中提取运单号
   * 优先级：条码/二维码 → OCR 文本 → 规则匹配
   */
  async extractTrackingNumber(imageBuffer: Buffer): Promise<{
    trackingNo: string | null;
    carrier: string | null;
    confidence: number;
    method: string;
    rawText?: string;
  }> {
    // 1. 尝试识别二维码/条码
    this.logger.debug('开始尝试识别二维码/条码');
    try {
      const qrResult = await this.scanQRCode(imageBuffer);
      if (qrResult) {
        this.logger.debug('二维码识别成功', { contentPreview: qrResult.substring(0, 100) });
        const trackingNo = this.extractTrackingNumberFromText(qrResult);
        if (trackingNo) {
          this.logger.log('从二维码内容中提取到运单号', { trackingNo });
          return {
            trackingNo,
            carrier: this.detectCarrier(trackingNo, qrResult),
            confidence: 0.95,
            method: 'qrcode',
            rawText: qrResult,
          };
        } else {
          this.logger.debug('二维码识别成功，但未能从内容中提取运单号，继续 OCR 文字识别');
        }
      } else {
        this.logger.debug('未识别到二维码，继续 OCR 文字识别');
      }
    } catch (error) {
      this.logger.warn('二维码识别异常', { error });
      // 忽略错误，继续 OCR
    }

    // 2. OCR 文本识别（优先使用 OCR.space API，备用讯飞 OCR API）
    try {
      // 优先使用 OCR.space API
      let ocrText = await this.performOCRSpace(imageBuffer);
      
      // 如果 OCR.space 失败，尝试讯飞 OCR（作为备用）
      if (!ocrText) {
        this.logger.debug('OCR.space 识别失败，尝试使用讯飞 OCR');
        ocrText = await this.performOCR(imageBuffer);
      }
      
      if (ocrText) {
        // 3. 规则匹配提取运单号
        const trackingNo = this.extractTrackingNumberFromText(ocrText);
        if (trackingNo) {
          return {
            trackingNo,
            carrier: this.detectCarrier(trackingNo, ocrText),
            confidence: 0.85,
            method: 'ocr',
            rawText: ocrText,
          };
        }
      }
    } catch (error: any) {
      // OCR 失败不应该阻止整个流程，只记录警告
      this.logger.warn('OCR 识别失败（将跳过 OCR，用户可手动输入）', { error: error.message || error });
      // 不抛出错误，让流程继续
    }

    return {
      trackingNo: null,
      carrier: null,
      confidence: 0,
      method: 'none',
    };
  }

  /**
   * 扫描二维码/条码
   * 简化版：只尝试最有效的2-3种策略，快速失败
   */
  private async scanQRCode(imageBuffer: Buffer): Promise<string | null> {
    try {
      // 只保留最有效的预处理策略（减少处理时间）
      const preprocessingStrategies = [
        // 策略1: 原始图片 + 标准化对比度（最快，最常用）
        { name: 'original-normalize', processor: (buf: Buffer) => sharp(buf).normalize().ensureAlpha().raw() },
        
        // 策略2: 灰度化 + 增强对比度（处理彩色图片）
        { name: 'grayscale-enhanced', processor: (buf: Buffer) => 
          sharp(buf).greyscale().normalize({ lower: 5, upper: 95 }).ensureAlpha().raw() },
      ];

      // 只尝试一种 jsQR 策略（attemptBoth 包含 dontInvert）
      const jsQRStrategy = { inversionAttempts: 'attemptBoth' as const };

      // 快速尝试前2种策略
      for (const preprocessStrategy of preprocessingStrategies) {
        try {
          const { data, info } = await preprocessStrategy.processor(imageBuffer).toBuffer({ resolveWithObject: true });
          
          // 转换为 RGBA 格式
          let imageData: Uint8ClampedArray;
          if (info.channels === 4) {
            imageData = new Uint8ClampedArray(data);
          } else if (info.channels === 3) {
            const rgbaData = new Uint8ClampedArray(info.width * info.height * 4);
            for (let i = 0; i < info.width * info.height; i++) {
              rgbaData[i * 4] = data[i * 3];
              rgbaData[i * 4 + 1] = data[i * 3 + 1];
              rgbaData[i * 4 + 2] = data[i * 3 + 2];
              rgbaData[i * 4 + 3] = 255;
            }
            imageData = rgbaData;
          } else if (info.channels === 1) {
            // 灰度图转 RGBA
            const rgbaData = new Uint8ClampedArray(info.width * info.height * 4);
            for (let i = 0; i < info.width * info.height; i++) {
              const gray = data[i];
              rgbaData[i * 4] = gray;
              rgbaData[i * 4 + 1] = gray;
              rgbaData[i * 4 + 2] = gray;
              rgbaData[i * 4 + 3] = 255;
            }
            imageData = rgbaData;
          } else {
            continue;
          }

          // 尝试识别
          const code = jsQR(imageData, info.width, info.height, jsQRStrategy);
          
          if (code) {
            this.logger.log('二维码识别成功', {
              strategy: preprocessStrategy.name,
              contentLength: code.data.length,
            });
            return code.data;
          }
        } catch (error: any) {
          // 忽略错误，继续尝试下一个策略
          continue;
        }
      }
      
      // 快速失败：如果前2种策略都失败，直接返回null，不浪费时间
    } catch (error: any) {
      this.logger.debug('二维码识别错误', { error: error.message || error });
    }

    return null;
  }

  /**
   * 使用 OCR.space API 进行文本识别
   */
  private async performOCRSpace(imageBuffer: Buffer): Promise<string | null> {
    // 在函数作用域中定义，以便在 catch 块中访问
    let optimizedBuffer = imageBuffer;
    
    try {
      this.logger.debug('使用 OCR.space API 进行识别', { 
        originalSize: imageBuffer.length 
      });
      
      // 优化图片大小：OCR.space 免费版限制 1MB，超过 1MB 才压缩
      // 为了提高识别准确率，压缩时使用更高的质量和更大的尺寸
      optimizedBuffer = imageBuffer;
      const maxSize = 1024 * 1024; // 1MB（OCR.space 免费版限制）
      if (imageBuffer.length > maxSize) {
        this.logger.debug('图片较大，进行压缩优化', { 
          originalSize: imageBuffer.length,
          originalSizeKB: (imageBuffer.length / 1024).toFixed(2) + ' KB'
        });
        try {
          optimizedBuffer = await sharp(imageBuffer)
            .resize(3000, null, { 
              withoutEnlargement: true,
              fit: 'inside' 
            })
            .jpeg({ quality: 95 }) // 提高质量到 95%，保持更好的识别准确率
            .toBuffer();
          this.logger.debug('图片压缩完成', { 
            originalSize: imageBuffer.length,
            originalSizeKB: (imageBuffer.length / 1024).toFixed(2) + ' KB',
            optimizedSize: optimizedBuffer.length,
            optimizedSizeKB: (optimizedBuffer.length / 1024).toFixed(2) + ' KB',
            compressionRatio: ((1 - optimizedBuffer.length / imageBuffer.length) * 100).toFixed(1) + '%'
          });
        } catch (compressError) {
          this.logger.warn('图片压缩失败，使用原始图片', { error: compressError });
          optimizedBuffer = imageBuffer;
        }
      } else {
        this.logger.debug('图片大小合适，无需压缩', {
          size: imageBuffer.length,
          sizeKB: (imageBuffer.length / 1024).toFixed(2) + ' KB'
        });
      }
      
      // 创建 FormData
      // 添加有助于提高识别准确率的参数（与在线 OCR 服务保持一致）
      const formData = new FormData();
      formData.append('file', optimizedBuffer, {
        filename: 'image.jpg',
        contentType: 'image/jpeg',
      });
      formData.append('language', 'chs'); // 中文简体
      formData.append('isOverlayRequired', 'false'); // 不需要坐标覆盖
      formData.append('detectOrientation', 'true'); // 自动检测方向（提高识别准确率）
      formData.append('scale', 'true'); // 自动缩放（提高识别准确率）
      formData.append('OCREngine', '2'); // 使用引擎 2（更好的中文识别，提高准确率）
      // 这些参数有助于提高识别准确率，特别是在识别快递单号等长数字时

      // 发送请求到 OCR.space API
      // 添加了额外的 OCR 参数（detectOrientation, scale, OCREngine）后，处理时间可能变长
      const requestStartTime = Date.now();
      this.logger.debug('准备发送 OCR 请求', {
        optimizedSize: optimizedBuffer.length,
        optimizedSizeKB: (optimizedBuffer.length / 1024).toFixed(2) + ' KB',
        originalSize: imageBuffer.length,
        originalSizeKB: (imageBuffer.length / 1024).toFixed(2) + ' KB',
        timeout: '10s',
        apiUrl: this.ocrSpaceApiUrl,
        apiKeyPreview: this.ocrSpaceApiKey.substring(0, 5) + '...',
        ocrParams: {
          detectOrientation: true,
          scale: true,
          ocrEngine: 2,
        },
      });
      
      const response = await axios.post(this.ocrSpaceApiUrl, formData, {
        headers: {
          'apikey': this.ocrSpaceApiKey,
          ...formData.getHeaders(),
        },
        timeout: 5000, // 5秒超时（添加额外参数后需要更长时间处理）
        maxContentLength: Infinity, // 允许任意大小的响应
        maxBodyLength: Infinity, // 允许任意大小的请求体
      });
      
      const requestDuration = Date.now() - requestStartTime;
      this.logger.debug('OCR 请求完成', {
        duration: `${requestDuration}ms`,
        status: response.status,
      });

      this.logger.debug('OCR.space API 响应状态', { status: response.status });
      
      if (response.data && response.data.ParsedResults && response.data.ParsedResults.length > 0) {
        const parsedResult = response.data.ParsedResults[0];
        const exitCode = parsedResult.FileParseExitCode;
        
        if (exitCode === 1) {
          // 成功
          const parsedText = parsedResult.ParsedText || '';
          this.logger.log('OCR.space 识别成功', { textLength: parsedText.length });
          // 记录完整的 OCR 文本（用于调试运单号提取问题）
          if (process.env.NODE_ENV === 'development') {
            this.logger.debug('OCR 完整识别文本', { 
              fullText: parsedText.trim(),
              textLength: parsedText.length 
            });
          }
          return parsedText.trim();
        } else {
          // 错误
          const errorMessage = parsedResult.ErrorMessage || '未知错误';
          this.logger.warn('OCR.space 识别失败', { errorMessage });
          return null;
        }
      } else if (response.data && response.data.IsErroredOnProcessing) {
        const errorMessage = response.data.ErrorMessage || '处理错误';
        this.logger.warn('OCR.space API 处理错误', { errorMessage });
        return null;
      } else {
        this.logger.warn('OCR.space API 返回格式异常', { responseData: response.data });
        return null;
      }
    } catch (error: any) {
      // 构建详细的错误信息
      const errorDetails: any = {
        message: error.message || '未知错误',
        code: error.code,
        name: error.name,
      };

      // 处理 axios 响应错误
      if (error.response) {
        errorDetails.response = {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
        };
        this.logger.error('OCR.space API 调用失败 - HTTP 错误', errorDetails);
      } 
      // 处理请求错误（网络错误、超时等）
      else if (error.request) {
        errorDetails.requestError = true;
        errorDetails.timeout = error.code === 'ECONNABORTED';
        errorDetails.errno = error.errno;
        errorDetails.syscall = error.syscall;
        errorDetails.address = error.address;
        errorDetails.port = error.port;
        errorDetails.stack = error.stack;
        
        // 添加更详细的错误分类
        let errorType = '未知网络错误';
        if (error.code === 'ECONNABORTED') {
          errorType = '请求超时';
        } else if (error.code === 'ECONNREFUSED') {
          errorType = '连接被拒绝';
        } else if (error.code === 'ENOTFOUND') {
          errorType = 'DNS 解析失败';
        } else if (error.code === 'ETIMEDOUT') {
          errorType = '连接超时';
        } else if (error.code === 'EAI_AGAIN') {
          errorType = 'DNS 查询失败（临时）';
        } else if (error.code === 'ECONNRESET') {
          errorType = '连接被重置';
        } else if (error.code) {
          errorType = `网络错误: ${error.code}`;
        }
        
        errorDetails.errorType = errorType;
        
        // 输出详细的错误信息
        this.logger.error('OCR.space API 调用失败 - 网络错误', {
          errorType,
          message: errorDetails.message,
          code: errorDetails.code,
          errno: errorDetails.errno,
          syscall: errorDetails.syscall,
          address: errorDetails.address,
          port: errorDetails.port,
          timeout: errorDetails.timeout,
          apiUrl: this.ocrSpaceApiUrl,
          apiKeyPreview: this.ocrSpaceApiKey ? `${this.ocrSpaceApiKey.substring(0, 5)}...` : '未设置',
        });
        
        // 输出完整的错误详情（debug 级别）
        this.logger.debug('OCR.space API 网络错误详情', errorDetails);
      }
      // 处理其他错误
      else {
        // 尝试序列化错误对象
        try {
          errorDetails.errorString = JSON.stringify(error, Object.getOwnPropertyNames(error));
        } catch {
          errorDetails.errorString = String(error);
        }
        this.logger.error('OCR.space API 调用失败', errorDetails);
      }

      // 记录诊断信息
      this.logger.debug('OCR.space API 诊断信息', {
        apiKeySet: !!this.ocrSpaceApiKey,
        apiKeyLength: this.ocrSpaceApiKey?.length || 0,
        apiUrl: this.ocrSpaceApiUrl,
        originalImageSize: imageBuffer.length,
        optimizedImageSize: optimizedBuffer?.length || imageBuffer.length,
        timeout: '5s',
      });
      
      // 如果是超时错误，提供更详细的建议
      if (error.code === 'ECONNABORTED' && error.message?.includes('timeout')) {
        const optimizedSize = optimizedBuffer?.length || imageBuffer.length;
        this.logger.warn('OCR.space API 超时 - 详细诊断', {
          suggestion: 'OCR.space API 连接超时，可能的原因：',
          possibleCauses: [
            '1. 网络连接问题（检查网络连接是否正常）',
            '2. API Key 无效或已过期（当前使用默认值，建议配置有效的 API Key）',
            '3. OCR.space 服务暂时不可用',
            '4. 免费版速率限制（如果短时间内请求过多）',
            '5. 图片太大或格式不支持',
          ],
          imageSize: imageBuffer.length,
          imageSizeKB: (imageBuffer.length / 1024).toFixed(2) + ' KB',
          optimizedSize: optimizedSize,
          optimizedSizeKB: (optimizedSize / 1024).toFixed(2) + ' KB',
          timeoutSeconds: 5,
          apiKeyPreview: this.ocrSpaceApiKey ? `${this.ocrSpaceApiKey.substring(0, 5)}...` : '未设置',
          apiKeyFromEnv: !!(this.configService?.get<string>('OCR_SPACE_API_KEY') || process.env.OCR_SPACE_API_KEY),
          nextSteps: [
            '1. 检查网络连接是否正常',
            '2. 验证 OCR_SPACE_API_KEY 环境变量是否正确配置',
            '3. 访问 https://ocr.space/ocrapi 注册并获取新的 API Key',
            '4. 系统将自动尝试使用备用方案（讯飞 OCR）',
            '5. 如果都失败，可以使用手动输入功能',
          ],
        });
      }

      return null;
    }
  }

  /**
   * 使用讯飞 OCR API 进行文本识别（备用）
   */
  private async performOCR(imageBuffer: Buffer): Promise<string | null> {
    try {
      // 将图片转换为 base64
      const base64Image = imageBuffer.toString('base64');
      
      // 生成认证信息
      const authUrl = this.generateAuthUrl();
      
      // 使用 WebSocket 连接讯飞 OCR API
      this.logger.debug('准备连接讯飞 OCR API', { authUrlPreview: authUrl.substring(0, 100) + '...' });
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(authUrl);
        let resultText = '';

        ws.on('open', () => {
          this.logger.debug('WebSocket 连接已建立，准备发送识别请求');
          // 发送识别请求
          // 注意：根据讯飞 OCR API 文档，参数名称可能不同，需要根据实际 API 调整
          // 参考讯飞文档：https://www.xfyun.cn/doc/
          const requestData = {
            header: {
              app_id: this.xfyunAppId,
              status: 3, // 3 表示一次性传输完成
            },
            parameter: {
              // OCR 服务参数，根据实际 API 文档调整
              // 通用文字识别的参数名称可能是 s50f6e6c1 或其他
              s50f6e6c1: {
                category: 'ch_en_public_cloud', // 中英文识别
                result: {
                  encoding: 'utf8',
                  compress: 'raw',
                  format: 'json',
                },
              },
            },
            payload: {
              // 图片数据
              s50f6e6c1_data_1: {
                encoding: 'jpg', // 图片格式（jpg/png）
                image: base64Image, // base64 编码的图片
                status: 3, // 3 表示最后一块数据
              },
            },
          };

          this.logger.debug('发送识别请求', { imageSize: base64Image.length });
          ws.send(JSON.stringify(requestData));
        });

        ws.on('message', (data: WebSocket.Data) => {
          try {
            const result = JSON.parse(data.toString());
            this.logger.debug('收到讯飞 OCR 响应', { responsePreview: JSON.stringify(result).substring(0, 500) });
            
            if (result.header?.code === 0) {
              // 成功
              // 根据实际 API 响应格式提取文本
              // 可能的路径：result.payload.s50f6e6c1.result.text 或 result.payload.result.text
              let text = '';
              
              // 尝试多种可能的响应格式
              if (result.payload?.s50f6e6c1?.result?.text) {
                text = result.payload.s50f6e6c1.result.text;
              } else if (result.payload?.ocr?.result?.text) {
                text = result.payload.ocr.result.text;
              } else if (result.payload?.result?.text) {
                text = result.payload.result.text;
              } else if (result.payload?.text) {
                text = result.payload.text;
              } else if (typeof result.payload === 'string') {
                // 如果 payload 直接是文本或 JSON 字符串
                try {
                  const payloadObj = JSON.parse(result.payload);
                  text = payloadObj.text || payloadObj.result?.text || payloadObj.data?.text || '';
                } catch {
                  text = result.payload;
                }
              } else if (result.data?.text) {
                text = result.data.text;
              }
              
              if (text) {
                resultText += text;
                this.logger.debug('提取到文本片段', { textLength: text.length });
              }
              
              // 检查是否完成（status: 2 表示完成）
              if (result.header?.status === 2) {
                this.logger.log('识别完成', { totalTextLength: resultText.length });
                ws.close();
                resolve(resultText || null);
              }
            } else {
              // 错误
              const errorMsg = result.header?.message || result.header?.code || '未知错误';
              this.logger.error('讯飞 OCR API 错误', {
                errorMsg,
                fullResponse: JSON.stringify(result),
              });
              ws.close();
              reject(new Error(`讯飞 OCR API 错误: ${errorMsg}`));
            }
          } catch (error) {
            this.logger.error('解析响应失败', { error });
            // 如果解析失败，尝试直接使用响应作为文本
            const responseStr = data.toString();
            if (responseStr && responseStr.length > 0) {
              resultText += responseStr;
            }
          }
        });

        ws.on('error', (error: any) => {
          this.logger.error('WebSocket 连接错误', {
            error: error.message || error,
            code: error.code,
            message: error.message,
            stack: error.stack,
          });
          // 403 错误通常是认证问题
          if (error.message?.includes('403') || error.message?.includes('Unexpected server response: 403')) {
            const isUsingDefaultCredentials = 
              this.xfyunAppId === 'e5090a9d' ||
              this.xfyunApiKey === '76faa70774cf22d1a048f940786fd301' ||
              this.xfyunApiSecret === 'ZTFkMWVmZWIwMmY3MGNiMTRmOGMyZGRh';
            
            this.logger.error('⚠️ 讯飞 OCR 403 错误 - 认证失败', {
              error: error.message,
              possibleCauses: [
                '1. API 凭证无效或已过期（当前可能使用默认值）',
                '2. API Key 或 API Secret 配置错误',
                '3. App ID 不存在或已停用',
                '4. 认证 URL 生成错误',
                '5. 账户权限不足或服务未开通',
              ],
              currentConfig: {
                appId: this.xfyunAppId,
                appIdPreview: this.xfyunAppId ? `${this.xfyunAppId.substring(0, 5)}...` : '未设置',
                apiKeySet: !!this.xfyunApiKey,
                apiKeyLength: this.xfyunApiKey?.length,
                apiKeyPreview: this.xfyunApiKey ? `${this.xfyunApiKey.substring(0, 5)}...` : '未设置',
                apiSecretSet: !!this.xfyunApiSecret,
                apiSecretLength: this.xfyunApiSecret?.length,
                apiSecretPreview: this.xfyunApiSecret ? `${this.xfyunApiSecret.substring(0, 5)}...` : '未设置',
                isUsingDefaultCredentials,
              },
              nextSteps: [
                '1. 检查 XFYUN_APP_ID、XFYUN_API_KEY、XFYUN_API_SECRET 环境变量是否正确',
                '2. 访问 https://www.xfyun.cn/ 注册并获取有效的 API 凭证',
                '3. 确保已开通 OCR 服务',
                '4. 验证 API 凭证是否在有效期内',
                '5. 如果不需要 OCR 功能，可以使用手动输入运单号',
              ],
              note: 'OCR 功能失败不影响系统使用，用户可以手动输入运单号',
            });
          } else {
            this.logger.error('讯飞 OCR WebSocket 连接失败', {
              error: error.message,
              suggestion: '可能是网络问题或服务暂时不可用',
            });
          }
          ws.close();
          // 不抛出错误，而是返回 null，让调用方知道 OCR 失败但可以继续
          resolve(null);
        });

        ws.on('close', () => {
          if (resultText) {
            resolve(resultText);
          } else {
            resolve(null);
          }
        });

        // 设置超时
        setTimeout(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close();
          }
          if (!resultText) {
            reject(new Error('OCR 识别超时'));
          }
        }, 30000); // 30秒超时
      });
    } catch (error) {
      this.logger.error('OCR 识别异常', { error });
      return null;
    }
  }

  /**
   * 生成讯飞 OCR API 认证 URL
   */
  private generateAuthUrl(): string {
    const host = 'ws-api.xfyun.cn';
    const path = '/v2/ocr';
    // 生成 RFC1123 格式的时间戳
    const date = new Date().toUTCString();
    
    // 构造签名字符串
    const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
    
    // 使用 HMAC-SHA256 计算签名
    const signatureSha = crypto
      .createHmac('sha256', this.xfyunApiSecret)
      .update(signatureOrigin)
      .digest('base64');
    
    // 构造授权参数
    const authorizationOrigin = `api_key="${this.xfyunApiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`;
    const authorization = Buffer.from(authorizationOrigin).toString('base64');
    
    // 生成认证参数
    const authParams = new URLSearchParams({
      authorization,
      date,
      host,
    });
    
    return `wss://${host}${path}?${authParams.toString()}`;
  }

  /**
   * 从文本中提取运单号（规则匹配）
   * 支持 OCR 错误纠正（如 8 被识别为 3）
   */
  private extractTrackingNumberFromText(text: string): string | null {
    if (!text) return null;

    if (process.env.NODE_ENV === 'development') {
      this.logger.debug('开始从文本中提取运单号', {
        textLength: text.length,
        textPreview: text.substring(0, 200),
      });
    }

    // 常见快递单号规则（按优先级排序，更长的格式优先）
    // 注意：OCR 识别可能不完整，需要尝试匹配更长的格式
    const patterns = [
      /SF\d{13,15}/i, // 顺丰：SF + 13-15位数字（完整格式，优先级最高）
      /SF\d{12,15}/i, // 顺丰：SF + 12-15位数字（不区分大小写，优先级高）
      /SF\d{9}[A-Z0-9]{2,4}/i, // 顺丰：SF + 9位数字 + 2-4位字母数字组合（备用格式）
      /YT\d{10,13}/i, // 圆通：YT + 10-13位数字（不区分大小写）
      /[A-Z]{2}\d{10,13}/i, // 中通、韵达等：2位字母+10-13位数字
      /\d{12,15}/, // 圆通、申通等：12-15位纯数字（可能包含完整运单号）
      /[A-Z0-9]{12,16}/i, // 通用格式：12-16位字母数字组合（匹配更长的运单号）
      /\d{11}/, // 11位数字
    ];

    // 先尝试精确匹配，优先匹配最长的格式
    for (const pattern of patterns) {
      const matches = text.match(pattern);
      if (matches && matches[0]) {
        const trackingNo = matches[0];
        // 验证长度和格式
        // 对于顺丰，优先匹配 13-15 位的完整格式
        if (trackingNo.length >= 10 && trackingNo.length <= 20) {
          // 如果是顺丰且长度小于 13，尝试在文本中查找更长的匹配
          if (trackingNo.toUpperCase().startsWith('SF') && trackingNo.length < 13) {
            this.logger.debug('找到顺丰运单号但长度较短，尝试查找更长的匹配', { 
              found: trackingNo, 
              length: trackingNo.length 
            });
            // 继续查找更长的匹配
            continue;
          }
          this.logger.debug('找到运单号（精确匹配）', { pattern: pattern.toString(), trackingNo });
          return trackingNo.toUpperCase(); // 统一转为大写
        }
      }
    }

    // 如果精确匹配失败，尝试提取所有可能的运单号
    const allMatches: string[] = [];
    for (const pattern of patterns) {
      const regex = new RegExp(pattern, 'g');
      let match;
      while ((match = regex.exec(text)) !== null) {
        if (match[0] && match[0].length >= 10 && match[0].length <= 20) {
          allMatches.push(match[0]);
        }
      }
    }

    // 返回最长的匹配（通常是完整的运单号）
    if (allMatches.length > 0) {
      const bestMatch = allMatches.sort((a, b) => b.length - a.length)[0];
      this.logger.debug('找到运单号（多匹配）', { bestMatch });
      return bestMatch.toUpperCase();
    }

    // 如果仍然没有找到，尝试 OCR 错误纠正
    // 常见错误：8 被识别为 3, 0 被识别为 O, 1 被识别为 I 等
    this.logger.debug('尝试 OCR 错误纠正');
    const correctedText = this.correctOcrErrors(text);
    if (correctedText !== text) {
      if (process.env.NODE_ENV === 'development') {
        this.logger.debug('纠正后的文本', { correctedTextPreview: correctedText.substring(0, 200) });
      }
      // 在纠正后的文本中再次查找
      for (const pattern of patterns) {
        const matches = correctedText.match(pattern);
        if (matches && matches[0]) {
          const trackingNo = matches[0];
          if (trackingNo.length >= 10 && trackingNo.length <= 20) {
            this.logger.debug('找到运单号（纠正后）', { trackingNo });
            return trackingNo.toUpperCase();
          }
        }
      }
    }

    return null;
  }

  /**
   * 纠正常见的 OCR 识别错误
   * 特别是数字识别错误：8 被识别为 3, 0 被识别为 O 等
   */
  private correctOcrErrors(text: string): string {
    // 对于 12-13 位数字，尝试纠正常见的错误
    const longNumberPattern = /\d{12,13}/;
    const match = text.match(longNumberPattern);
    if (match) {
      let corrected = match[0];
      let hasCorrection = false;
      
      // 常见 OCR 错误纠正规则
      // 1. 如果数字以 3 开头，可能是 8 的误识别（特别是 8814... 被识别为 3814...）
      if (corrected.startsWith('3') && corrected.length >= 12) {
        // 检查上下文：如果文本中包含"圆通"等关键词，更可能是 8
        const textUpper = text.toUpperCase();
        const isYuantong = textUpper.includes('圆通') || textUpper.includes('YTO') || textUpper.includes('YT');
        
        // 如果第二位数字是 8，或者包含圆通关键词，很可能是 8 被识别为 3
        if (corrected[1] === '8' || isYuantong) {
          corrected = '8' + corrected.substring(1);
          hasCorrection = true;
          this.logger.debug('纠正运单号（3->8，圆通）', { original: match[0], corrected });
        } else {
          // 即使没有明确证据，也尝试纠正（因为 8 被识别为 3 很常见）
          corrected = '8' + corrected.substring(1);
          hasCorrection = true;
          this.logger.debug('纠正运单号（3->8，尝试）', { original: match[0], corrected });
        }
      }
      
      // 2. 其他常见错误：0 被识别为 O, 1 被识别为 I
      // 对于纯数字运单号，这些错误较少，暂时不处理
      
      if (hasCorrection) {
        return text.replace(match[0], corrected);
      }
    }

    return text;
  }

  /**
   * 根据运单号前缀判断承运商
   * 同时检查 OCR 识别的原始文本中是否包含快递公司名称
   */
  private detectCarrier(trackingNo: string, rawText?: string): string | null {
    if (!trackingNo) return null;

    const trackingNoUpper = trackingNo.toUpperCase();

    // 根据运单号前缀判断承运商
    const carrierMap: Record<string, string> = {
      'SF': '顺丰',
      'YT': '圆通',
      'ST': '申通',
      'ZT': '中通',
      'YD': '韵达',
      'JD': '京东',
      'EMS': 'EMS',
      'DHL': 'DHL',
      'UPS': 'UPS',
      'FEDEX': 'FedEx',
    };

    // 优先检查运单号前缀
    for (const [prefix, name] of Object.entries(carrierMap)) {
      if (trackingNoUpper.startsWith(prefix)) {
        this.logger.debug('根据运单号前缀识别快递公司', { prefix, name });
        return name;
      }
    }

    // 如果运单号没有前缀，尝试从原始文本中查找快递公司名称
    if (rawText) {
      const textUpper = rawText.toUpperCase();
      const carrierKeywords: Record<string, string> = {
        '圆通': '圆通',
        'YTO': '圆通',
        'YTOO': '圆通',
        '顺丰': '顺丰',
        'SF': '顺丰',
        '申通': '申通',
        'STO': '申通',
        '中通': '中通',
        'ZTO': '中通',
        '韵达': '韵达',
        'YUNDA': '韵达',
        '京东': '京东',
        'JD': '京东',
        'EMS': 'EMS',
        '邮政': 'EMS',
      };

      for (const [keyword, name] of Object.entries(carrierKeywords)) {
        if (textUpper.includes(keyword)) {
          this.logger.debug('从文本中识别快递公司', { keyword, name });
          return name;
        }
      }
    }

    // 根据长度和格式推断
    if (trackingNo.length === 12 || trackingNo.length === 13) {
      // 12-13位数字通常是圆通、申通、中通、韵达
      if (/^\d+$/.test(trackingNo)) {
        this.logger.debug('根据长度推断为通用快递（12-13位数字）');
        return '快递'; // 通用快递
      }
    }

    if (trackingNo.length >= 10 && trackingNo.length <= 15) {
      this.logger.debug('根据长度推断为通用快递（10-15位）');
      return '快递'; // 通用快递
    }

    return null;
  }
}
