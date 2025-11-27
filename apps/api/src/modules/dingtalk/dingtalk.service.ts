import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface DingTalkMessage {
  msgtype: 'text' | 'markdown' | 'link' | 'actionCard' | 'feedCard';
  text?: {
    content: string;
  };
  markdown?: {
    title: string;
    text: string;
  };
  link?: {
    text: string;
    title: string;
    picUrl?: string;
    messageUrl: string;
  };
  actionCard?: {
    title: string;
    text: string;
    btnOrientation?: '0' | '1'; // 0-按钮竖直排列，1-按钮横向排列
    btns?: Array<{
      title: string;
      actionURL: string;
    }>;
    singleTitle?: string;
    singleURL?: string;
  };
  at?: {
    atMobiles?: string[];
    atUserIds?: string[];
    isAtAll?: boolean;
  };
}

@Injectable()
export class DingTalkService {
  private readonly logger = new Logger(DingTalkService.name);
  private readonly webhookUrl: string;
  private readonly enabled: boolean;
  private readonly webUrl: string;

  constructor(@Optional() private configService?: ConfigService) {
    // 从环境变量获取webhook URL
    // 如果 ConfigService 未注入（如 Worker 启动时），直接使用 process.env
    const envUrl = this.configService?.get<string>('DINGTALK_WEBHOOK_URL');
    const processEnvUrl = process.env.DINGTALK_WEBHOOK_URL;
    
    // 调试信息：检查环境变量来源
    this.logger.debug(`[DingTalkService] 环境变量检查:`);
    this.logger.debug(`  - ConfigService available: ${!!this.configService}`);
    this.logger.debug(`  - ConfigService.get('DINGTALK_WEBHOOK_URL'): ${envUrl ? '已设置 (长度: ' + envUrl.length + ')' : '未设置'}`);
    this.logger.debug(`  - process.env.DINGTALK_WEBHOOK_URL: ${processEnvUrl ? '已设置 (长度: ' + processEnvUrl.length + ')' : '未设置'}`);
    
    // 优先使用 ConfigService，如果为空则尝试 process.env
    const finalUrl = envUrl || processEnvUrl;
    
    // 生产环境必须配置，开发环境允许为空（禁用功能）
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (!finalUrl || finalUrl.trim().length === 0) {
      if (isProduction) {
        this.logger.warn('⚠️ 生产环境未配置 DINGTALK_WEBHOOK_URL，钉钉通知功能将被禁用');
      } else {
        this.logger.debug('开发环境未配置 DINGTALK_WEBHOOK_URL，钉钉通知功能将被禁用');
      }
      this.webhookUrl = '';
      this.enabled = false;
    } else {
      this.webhookUrl = finalUrl.trim();
      this.enabled = true;
      // 只记录URL的前50个字符，避免泄露完整token
      this.logger.log(`✅ 钉钉机器人已启用，Webhook URL: ${this.webhookUrl.substring(0, 50)}...`);
    }

    // 获取前端URL配置，用于生成完整链接
    const envWebUrl = this.configService?.get<string>('WEB_URL');
    const processWebUrl = process.env.WEB_URL;
    const rawWebUrl = (envWebUrl || processWebUrl || 'http://localhost:8080').trim();
    // 移除末尾的斜杠（如果有）
    this.webUrl = rawWebUrl.replace(/\/+$/, '');
    
    // 记录 WEB_URL 配置（用于调试）
    this.logger.log(`📱 WEB_URL 配置: ${this.webUrl} (用于钉钉消息链接)`);
    if (this.webUrl.includes('localhost') || this.webUrl.includes('127.0.0.1')) {
      this.logger.warn(`⚠️ WEB_URL 包含 localhost，手机端可能无法访问。建议设置为实际 IP 地址，例如: http://192.168.x.x:8080`);
    }
  }

  /**
   * 发送文本消息
   */
  async sendText(content: string, atMobiles?: string[], atUserIds?: string[], isAtAll = false) {
    const message: DingTalkMessage = {
      msgtype: 'text',
      text: {
        content,
      },
      at: {
        atMobiles,
        atUserIds,
        isAtAll,
      },
    };

    return this.send(message);
  }

  /**
   * 发送Markdown消息
   */
  async sendMarkdown(title: string, text: string, atMobiles?: string[], atUserIds?: string[], isAtAll = false) {
    const message: DingTalkMessage = {
      msgtype: 'markdown',
      markdown: {
        title,
        text,
      },
      at: {
        atMobiles,
        atUserIds,
        isAtAll,
      },
    };

    return this.send(message);
  }

  /**
   * 发送ActionCard消息（支持按钮点击跳转）
   */
  async sendActionCard(
    title: string,
    text: string,
    buttonTitle: string,
    buttonUrl: string,
    btnOrientation: '0' | '1' = '0',
  ) {
    const message: DingTalkMessage = {
      msgtype: 'actionCard',
      actionCard: {
        title,
        text,
        btnOrientation,
        singleTitle: buttonTitle,
        singleURL: buttonUrl,
      },
    };

    return this.send(message);
  }

  /**
   * 发送链接消息
   */
  async sendLink(title: string, text: string, messageUrl: string, picUrl?: string) {
    const message: DingTalkMessage = {
      msgtype: 'link',
      link: {
        title,
        text,
        messageUrl,
        picUrl,
      },
    };

    return this.send(message);
  }

  /**
   * 发送通知消息（根据类型自动选择格式）
   * 返回结果对象，不会抛出错误，避免阻塞主流程
   */
  async sendNotification(data: {
    type: string;
    title: string;
    content: string;
    link?: string;
    userId?: string;
    userName?: string;
  }): Promise<{ success: boolean; error?: string; errcode?: number; reason?: string }> {
    if (!this.enabled) {
      this.logger.debug('钉钉机器人未启用，跳过发送');
      return { success: false, reason: '未启用' };
    }

    try {
      const { type, title, content, link, userName } = data;

      // 确保标题或内容中包含关键词"通知"
      // 钉钉机器人的关键词匹配要求消息中包含"通知"关键词
      let finalTitle = title;
      let finalContent = content;
      
      // 检查是否包含"通知"关键词
      const hasKeywordNotify = title.includes('通知') || content.includes('通知');
      
      // 如果消息中没有"通知"关键词，在内容开头添加
      if (!hasKeywordNotify) {
        finalContent = `通知：${content}`;
        finalTitle = `通知：${title}`;
      }

      // 将相对路径转换为完整URL
      let fullLink: string | undefined;
      if (link) {
        // 如果已经是完整URL，直接使用
        if (link.startsWith('http://') || link.startsWith('https://')) {
          fullLink = link;
        } else {
          // 相对路径转换为完整URL
          // 确保link以/开头
          const normalizedLink = link.startsWith('/') ? link : `/${link}`;
          fullLink = `${this.webUrl}${normalizedLink}`;
        }
        // 记录生成的完整链接（用于调试）
        this.logger.debug(`🔗 生成的钉钉消息链接: ${fullLink}`);
      }

      // 根据通知类型选择不同的消息格式
      switch (type) {
        case 'RFQ_PUBLISHED':
        case 'RFQ_UNQUOTED_ITEMS':
        case 'RFQ_CLOSED':
        case 'QUOTE_SUBMITTED':
        case 'QUOTE_AWARDED':
        case 'AWARD_CREATED':
        case 'SHIPMENT_CREATED':
        case 'AFTERSALES_ALERT':
        case 'REGISTRATION_PENDING':
          // 如果有链接，使用ActionCard格式（支持按钮点击跳转）
          if (fullLink) {
            const markdownText = this.formatMarkdownNotification(type, finalTitle, finalContent, undefined, userName);
            this.logger.debug(`📤 发送 ActionCard 消息，链接: ${fullLink}`);
            return await this.sendActionCard(finalTitle, markdownText, '查看详情', fullLink);
          } else {
            // 没有链接时使用Markdown格式
            const markdownText = this.formatMarkdownNotification(type, finalTitle, finalContent, link, userName);
            return await this.sendMarkdown(finalTitle, markdownText);
          }
        
        default:
          // 默认使用文本格式
          const textContent = this.formatTextNotification(finalTitle, finalContent, fullLink, userName);
          return await this.sendText(textContent);
      }
    } catch (error: any) {
      // 记录错误但不抛出，避免阻塞主流程
      this.logger.error('发送钉钉通知失败:', {
        error: error.message || error,
        type: data.type,
        title: data.title,
      });
      // 返回失败结果，不抛出错误
      return { success: false, error: error.message || '发送失败' };
    }
  }

  /**
   * 格式化Markdown通知
   * 注意：必须在消息的text字段中包含钉钉机器人的关键词（"通知"）
   * 钉钉机器人的关键词匹配只检查text字段，不检查title字段
   */
  private formatMarkdownNotification(
    type: string,
    title: string,
    content: string,
    link?: string,
    userName?: string,
  ): string {
    let emoji = '📢';
    let color = '#173177';

    // 根据类型设置不同的emoji和颜色
    switch (type) {
      case 'RFQ_PUBLISHED':
        emoji = '📢';
        color = '#4DABF7';
        break;
      case 'RFQ_UNQUOTED_ITEMS':
        emoji = '⚠️';
        color = '#FF6B6B';
        break;
      case 'RFQ_CLOSED':
        emoji = '✅';
        color = '#51CF66';
        break;
      case 'QUOTE_SUBMITTED':
        emoji = '💼';
        color = '#4DABF7';
        break;
      case 'QUOTE_AWARDED':
        emoji = '🎉';
        color = '#FFD43B';
        break;
      case 'AWARD_CREATED':
        emoji = '🎉';
        color = '#FFD43B';
        break;
      case 'REGISTRATION_PENDING':
        emoji = '🔔';
        color = '#FF6B6B';
        break;
      case 'SHIPMENT_CREATED':
        emoji = '📦';
        color = '#845EF7';
        break;
      case 'AFTERSALES_ALERT':
        emoji = '🔧';
        color = '#FF922B';
        break;
    }

    // 确保消息的text字段包含关键词"系统"、"通知"或"采购"
    // 钉钉机器人的关键词匹配只检查text字段，不检查title字段
    let markdown = `## ${emoji} ${title}\n\n`;
    
    if (userName) {
      markdown += `**用户**: ${userName}\n\n`;
    }

    markdown += `**内容**: ${content}\n\n`;
    markdown += `**时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;

    if (link) {
      markdown += `[查看详情](${link})\n\n`;
    }

    // 确保markdown的text字段中包含"通知"关键词
    // 钉钉机器人的关键词匹配要求消息中包含"通知"关键词
    const hasKeywordNotify = markdown.includes('通知');
    
    if (!hasKeywordNotify) {
      // 如果没有"通知"关键词，在末尾添加
      markdown += `\n---\n*通知*`;
    }

    return markdown;
  }

  /**
   * 格式化文本通知
   * 注意：必须在消息中包含钉钉机器人的关键词（"通知"）
   */
  private formatTextNotification(title: string, content: string, link?: string, userName?: string): string {
    let text = `${title}\n\n`;
    
    if (userName) {
      text += `用户: ${userName}\n`;
    }

    text += `内容: ${content}\n`;
    text += `时间: ${new Date().toLocaleString('zh-CN')}\n`;

    if (link) {
      text += `链接: ${link}`;
    }

    // 确保消息包含关键词"系统"、"通知"或"采购"（已在sendNotification中处理，这里不需要再检查）
    return text;
  }

  /**
   * 发送消息到钉钉（带重试机制）
   */
  private async send(message: DingTalkMessage, retryCount = 0): Promise<{ success: boolean; error?: string; errcode?: number; reason?: string }> {
    if (!this.enabled) {
      this.logger.debug('钉钉机器人未启用，跳过发送');
      return { success: false, reason: '未启用' };
    }

    const maxRetries = 2; // 最多重试2次
    const timeout = 30000; // 30秒超时

    try {
      // 记录发送的消息内容（用于调试关键词匹配）
      const messageContent = message.msgtype === 'text' 
        ? message.text?.content 
        : message.msgtype === 'markdown' 
        ? `标题: ${message.markdown?.title}\n内容: ${message.markdown?.text}` 
        : message.msgtype === 'actionCard'
        ? `标题: ${message.actionCard?.title}\n按钮: ${message.actionCard?.singleTitle}\n链接: ${message.actionCard?.singleURL}\n内容: ${message.actionCard?.text?.substring(0, 100)}`
        : JSON.stringify(message);
      this.logger.debug(`发送钉钉消息，类型: ${message.msgtype}, 重试次数: ${retryCount}, 内容: ${messageContent.substring(0, 300)}`);
      
      // 如果是 actionCard，特别记录链接信息
      if (message.msgtype === 'actionCard' && message.actionCard?.singleURL) {
        this.logger.log(`🔗 ActionCard 按钮链接: ${message.actionCard.singleURL}`);
      }

      const response = await axios.post(this.webhookUrl, message, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout, // 30秒超时
      });

      if (response.data.errcode === 0) {
        this.logger.debug('钉钉消息发送成功');
        return { success: true };
      } else {
        this.logger.warn(`钉钉消息发送失败: ${response.data.errmsg}, 错误码: ${response.data.errcode}`);
        return { success: false, error: response.data.errmsg, errcode: response.data.errcode };
      }
    } catch (error: any) {
      const isTimeout = error.code === 'ECONNABORTED' || error.message?.includes('timeout');
      const isNetworkError = error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT';
      
      // 如果是超时或网络错误，且还有重试次数，则重试
      if ((isTimeout || isNetworkError) && retryCount < maxRetries) {
        const delay = (retryCount + 1) * 1000; // 延迟1秒、2秒...
        this.logger.warn(`钉钉消息发送失败（${isTimeout ? '超时' : '网络错误'}），${delay}ms后重试 (${retryCount + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.send(message, retryCount + 1);
      }

      // 记录错误但不抛出，避免阻塞主流程
      this.logger.error('发送钉钉消息异常:', {
        message: error.message,
        code: error.code,
        response: error.response?.data,
        status: error.response?.status,
        retryCount,
        isTimeout,
        isNetworkError,
      });
      
      return { 
        success: false, 
        error: isTimeout 
          ? `请求超时（${timeout}ms）` 
          : isNetworkError 
          ? `网络错误: ${error.message}` 
          : error.message || '发送失败'
      };
    }
  }

  /**
   * 检查配置和链接生成（诊断用）
   */
  async checkConfig() {
    const testLink = '/rfqs/test123';
    let generatedLink: string | undefined;
    
    if (testLink) {
      if (testLink.startsWith('http://') || testLink.startsWith('https://')) {
        generatedLink = testLink;
      } else {
        const normalizedLink = testLink.startsWith('/') ? testLink : `/${testLink}`;
        generatedLink = `${this.webUrl}${normalizedLink}`;
      }
    }

    return {
      webUrl: this.webUrl,
      enabled: this.enabled,
      testLink,
      generatedLink,
      warning: this.webUrl.includes('localhost') || this.webUrl.includes('127.0.0.1')
        ? '⚠️ WEB_URL 包含 localhost，手机端无法访问。请设置为实际 IP 地址，例如: http://192.168.x.x:8080'
        : null,
      suggestion: '重启 API 服务后，WEB_URL 会自动从环境变量读取。如果仍为 localhost，请检查环境变量 WEB_URL 是否正确设置。',
    };
  }

  /**
   * 测试连接
   * 注意：测试消息必须包含关键词"通知"
   * 钉钉机器人的关键词匹配要求关键词必须出现在消息的text字段中（对于Markdown消息）
   */
  async testConnection() {
    if (!this.enabled) {
      // 提供更详细的错误信息
      const envUrl = this.configService?.get<string>('DINGTALK_WEBHOOK_URL');
      const processEnvUrl = process.env.DINGTALK_WEBHOOK_URL;
      return { 
        success: false, 
        message: '钉钉机器人未配置',
        details: {
          configService: envUrl ? '已设置' : '未设置',
          processEnv: processEnvUrl ? '已设置' : '未设置',
          suggestion: '请检查环境变量 DINGTALK_WEBHOOK_URL 是否正确配置，并重启服务'
        }
      };
    }

    try {
      // 测试消息必须包含"通知"关键词
      // 使用Markdown格式测试
      const testTitle = '通知：钉钉机器人测试';
      const testContent = '这是一条测试消息，用于验证钉钉机器人配置是否正确。';
      const testMarkdown = `## 📢 ${testTitle}\n\n**内容**: ${testContent}\n\n**时间**: ${new Date().toLocaleString('zh-CN')}\n\n`;
      
      this.logger.debug(`发送Markdown测试消息，标题: ${testTitle}, 内容: ${testContent}`);
      this.logger.debug(`Markdown中包含"通知": ${testMarkdown.includes('通知')}`);
      
      const result = await this.sendMarkdown(testTitle, testMarkdown);
      this.logger.debug(`测试消息发送结果: ${JSON.stringify(result)}`);
      
      if (!result.success && result.error) {
        return {
          success: false,
          message: `测试失败: ${result.error || '所有测试消息都失败，请检查钉钉机器人的关键词设置'}`,
          errcode: result.errcode,
          suggestion: '请确认钉钉机器人的关键词设置是否正确。关键词应该是"通知"。',
        };
      }
      
      return result;
    } catch (error: any) {
      this.logger.error(`测试连接失败: ${error.message}`, error);
      return {
        success: false,
        message: error.message || '测试失败',
      };
    }
  }
}

