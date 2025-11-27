import { Injectable, UnauthorizedException, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { NotificationService } from '../notification/notification.service';
import { DingTalkService } from '../dingtalk/dingtalk.service';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    @Optional() private notificationService?: NotificationService,
    @Optional() private dingTalkService?: DingTalkService,
  ) {}

  async validateUser(email: string, password: string): Promise<any> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (user && await bcrypt.compare(password, user.password)) {
      const { password: _, ...result } = user;
      return result;
    }
    return null;
  }

  async login(loginDto: LoginDto) {
    console.log('[AuthService] 开始验证用户:', { email: loginDto.email });
    
    const user = await this.validateUser(loginDto.email, loginDto.password);
    if (!user) {
      console.error('[AuthService] 用户验证失败:', { email: loginDto.email });
      throw new UnauthorizedException('Invalid credentials');
    }

    // 检查用户状态
    if (user.status === 'PENDING') {
      throw new UnauthorizedException('您的账号正在审核中，请等待管理员审核通过。如有疑问，请联系管理员：17267287629');
    }

    if (user.status === 'SUSPENDED') {
      throw new UnauthorizedException('您的账号已被暂停，请联系管理员');
    }

    if (user.status === 'INACTIVE') {
      throw new UnauthorizedException('您的账号未激活，请联系管理员');
    }

    console.log('[AuthService] 用户验证成功:', { userId: user.id, email: user.email, role: user.role });

    const payload = { email: user.email, sub: user.id, role: user.role, storeId: user.storeId };
    const access_token = this.jwtService.sign(payload);
    
    const result = {
      access_token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        storeId: user.storeId,
      },
    };
    
    console.log('[AuthService] 生成 Token 成功:', { 
      hasToken: !!result.access_token,
      tokenLength: result.access_token.length,
      userId: result.user.id,
    });
    
    return result;
  }

  async register(email: string, username: string, password: string, role: string) {
    const hashedPassword = await bcrypt.hash(password, 10);
    return this.prisma.user.create({
      data: {
        email,
        username,
        password: hashedPassword,
        role: role as any,
      },
    });
  }

  async registerStore(registerStoreDto: {
    email: string;
    username: string;
    password: string;
    storeName: string;
    storeCode: string;
    address?: string;
    contact?: string;
  }) {
    // 检查邮箱是否已存在
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerStoreDto.email },
    });

    if (existingUser) {
      throw new UnauthorizedException('该邮箱已被注册');
    }

    // 检查门店代码是否已存在
    const existingStore = await this.prisma.store.findUnique({
      where: { code: registerStoreDto.storeCode },
    });

    if (existingStore) {
      throw new UnauthorizedException('该门店代码已被使用');
    }

    const hashedPassword = await bcrypt.hash(registerStoreDto.password, 10);

    // 使用事务创建门店和用户
    return this.prisma.$transaction(async (tx) => {
      // 创建门店
      const store = await tx.store.create({
        data: {
          name: registerStoreDto.storeName,
          code: registerStoreDto.storeCode,
          address: registerStoreDto.address,
          contact: registerStoreDto.contact,
          status: 'ACTIVE',
        },
      });

      // 创建门店用户（状态为待审核）
      const user = await tx.user.create({
        data: {
          email: registerStoreDto.email,
          username: registerStoreDto.username,
          password: hashedPassword,
          role: 'STORE',
          storeId: store.id,
          status: 'PENDING',
        },
        select: {
          id: true,
          email: true,
          username: true,
          role: true,
          storeId: true,
          status: true,
        },
      });

      // 通知管理员（异步，不阻塞注册流程）
      console.log('[AuthService] 开始通知管理员关于新门店注册:', {
        userId: user.id,
        storeId: store.id,
        hasNotificationService: !!this.notificationService,
        hasDingTalkService: !!this.dingTalkService,
      });
      this.notifyAdminsAboutNewRegistration({
        type: 'STORE',
        user,
        store,
        details: {
          storeName: registerStoreDto.storeName,
          storeCode: registerStoreDto.storeCode,
          address: registerStoreDto.address,
          contact: registerStoreDto.contact,
        },
      }).catch((error) => {
        console.error('[AuthService] 通知管理员失败:', error);
      });

      return {
        user,
        store,
      };
    });
  }

  async registerSupplier(registerSupplierDto: {
    email: string;
    username: string;
    password: string;
    companyName?: string;
    contact?: string;
    address?: string;
  }) {
    // 检查邮箱是否已存在
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerSupplierDto.email },
    });

    if (existingUser) {
      throw new UnauthorizedException('该邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(registerSupplierDto.password, 10);

    // 创建供应商用户（状态为待审核）
    const user = await this.prisma.user.create({
      data: {
        email: registerSupplierDto.email,
        username: registerSupplierDto.username,
        password: hashedPassword,
        role: 'SUPPLIER',
        status: 'PENDING',
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
      },
    });

    // 通知管理员（异步，不阻塞注册流程）
    console.log('[AuthService] 开始通知管理员关于新供应商注册:', {
      userId: user.id,
      hasNotificationService: !!this.notificationService,
      hasDingTalkService: !!this.dingTalkService,
    });
    this.notifyAdminsAboutNewRegistration({
      type: 'SUPPLIER',
      user,
      details: {
        companyName: registerSupplierDto.companyName,
        contact: registerSupplierDto.contact,
        address: registerSupplierDto.address,
      },
    }).catch((error) => {
      console.error('[AuthService] 通知管理员失败:', error);
    });

    return {
      user,
    };
  }

  /**
   * 通知所有管理员关于新的注册申请
   */
  private async notifyAdminsAboutNewRegistration(data: {
    type: 'STORE' | 'SUPPLIER';
    user: any;
    store?: any;
    details: {
      storeName?: string;
      storeCode?: string;
      address?: string;
      contact?: string;
      companyName?: string;
    };
  }) {
    try {
      console.log('[AuthService] notifyAdminsAboutNewRegistration 开始执行:', {
        type: data.type,
        userId: data.user.id,
        hasNotificationService: !!this.notificationService,
        hasDingTalkService: !!this.dingTalkService,
      });

      // 获取所有管理员
      const admins = await this.prisma.user.findMany({
        where: {
          role: 'ADMIN',
          status: 'ACTIVE',
        },
        select: {
          id: true,
          email: true,
          username: true,
        },
      });

      console.log('[AuthService] 找到的管理员数量:', admins.length);
      if (admins.length === 0) {
        console.warn('[AuthService] 没有找到活跃的管理员，跳过通知');
        return;
      }

      const { type, user, store, details } = data;
      const typeLabel = type === 'STORE' ? '门店' : '供应商';
      const title = `新的${typeLabel}注册申请`;
      
      // 构建通知内容
      let content = `有新的${typeLabel}注册申请，请及时审核：\n\n`;
      content += `**${typeLabel}信息：**\n`;
      content += `- 用户名：${user.username}\n`;
      content += `- 邮箱：${user.email}\n`;
      
      if (type === 'STORE' && store) {
        content += `- 门店名称：${details.storeName}\n`;
        content += `- 门店代码：${details.storeCode}\n`;
        if (details.address) {
          content += `- 地址：${details.address}\n`;
        }
        if (details.contact) {
          content += `- 联系方式：${details.contact}\n`;
        }
      } else if (type === 'SUPPLIER') {
        if (details.companyName) {
          content += `- 公司名称：${details.companyName}\n`;
        }
        if (details.contact) {
          content += `- 联系方式：${details.contact}\n`;
        }
        if (details.address) {
          content += `- 地址：${details.address}\n`;
        }
      }
      
      content += `\n**申请时间：**${new Date(user.createdAt || Date.now()).toLocaleString('zh-CN')}\n`;
      content += `\n请前往管理后台审核该申请。`;

      // 生成审核链接
      const adminLink = `/admin?tab=pending-registrations`;

      // 为每个管理员创建通知
      if (this.notificationService) {
        console.log('[AuthService] 开始为管理员创建系统通知...');
        const notificationPromises = admins.map((admin) => {
          return this.notificationService!.create({
            userId: admin.id,
            type: 'REGISTRATION_PENDING',
            title,
            content,
            link: adminLink,
            userName: admin.username,
            sendDingTalk: false, // 避免重复发送钉钉消息
          }).catch((error) => {
            console.error(`[AuthService] 为管理员 ${admin.id} 创建通知失败:`, error);
            return null;
          });
        });

        const notificationResults = await Promise.all(notificationPromises);
        const successCount = notificationResults.filter(r => r !== null).length;
        console.log(`[AuthService] 系统通知创建完成: ${successCount}/${admins.length} 成功`);
      } else {
        console.warn('[AuthService] NotificationService 未注入，跳过系统通知');
      }

      // 发送钉钉通知（只发送一次，@所有管理员）
      if (this.dingTalkService && admins.length > 0) {
        console.log('[AuthService] 开始发送钉钉通知...');
        // 构建钉钉消息内容（Markdown格式）
        const dingTalkContent = `## ${title}\n\n${content}\n\n请及时审核该申请。`;
        
        const dingTalkResult = await this.dingTalkService.sendNotification({
          type: 'REGISTRATION_PENDING',
          title,
          content: dingTalkContent,
          link: adminLink,
          userId: admins[0].id, // 使用第一个管理员的ID
          userName: '管理员',
        });
        
        if (dingTalkResult.success) {
          console.log('[AuthService] ✅ 钉钉通知发送成功');
        } else {
          console.warn('[AuthService] ⚠️ 钉钉通知发送失败:', dingTalkResult.error || dingTalkResult.reason);
        }
      } else {
        if (!this.dingTalkService) {
          console.warn('[AuthService] DingTalkService 未注入，跳过钉钉通知');
        }
      }

      console.log(`[AuthService] ✅ 已通知 ${admins.length} 位管理员关于新的${typeLabel}注册申请`);
    } catch (error) {
      console.error('[AuthService] 通知管理员时发生错误:', error);
      console.error('[AuthService] 错误堆栈:', error instanceof Error ? error.stack : '无堆栈信息');
      // 不抛出错误，避免影响注册流程
    }
  }
}

