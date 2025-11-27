import { Injectable, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import { CreateSupplierDto, CreateSuppliersDto } from './dto/create-supplier.dto';

@Injectable()
export class AdminService {
  constructor(private prisma: PrismaService) {}

  async clearAllData() {
    // 使用事务确保数据一致性
    return this.prisma.$transaction(async (tx) => {
      // 删除所有业务数据，但保留用户和门店
      // 注意：需要按照外键依赖顺序删除
      await tx.afterSalesLog.deleteMany({});
      await tx.afterSalesCase.deleteMany({});
      await tx.trackingExtract.deleteMany({});
      await tx.package.deleteMany({});
      await tx.settlement.deleteMany({});
      await tx.shipment.deleteMany({});
      await tx.award.deleteMany({});
      await tx.quote.deleteMany({});
      await tx.orderRfq.deleteMany({});
      await tx.rfq.deleteMany({});
      await tx.order.deleteMany({});
      await tx.importTask.deleteMany({});
      await tx.notification.deleteMany({});
      await tx.auditLog.deleteMany({});

      return {
        message: '所有数据已清除成功',
        cleared: {
          orders: true,
          rfqs: true,
          quotes: true,
          shipments: true,
          afterSales: true,
          importTasks: true,
          notifications: true,
          auditLogs: true,
        },
      };
    });
  }

  /**
   * 创建单个供应商账号
   */
  async createSupplier(createSupplierDto: CreateSupplierDto) {
    // 检查邮箱是否已存在
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createSupplierDto.email },
    });

    if (existingUser) {
      throw new ConflictException(`邮箱 ${createSupplierDto.email} 已被使用`);
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(createSupplierDto.password, 10);

    // 创建供应商账号
    const supplier = await this.prisma.user.create({
      data: {
        email: createSupplierDto.email,
        username: createSupplierDto.username,
        password: hashedPassword,
        role: 'SUPPLIER',
        status: createSupplierDto.status || 'ACTIVE',
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

    return supplier;
  }

  /**
   * 批量创建供应商账号
   */
  async createSuppliers(createSuppliersDto: CreateSuppliersDto) {
    const { suppliers } = createSuppliersDto;

    if (!suppliers || suppliers.length === 0) {
      throw new BadRequestException('供应商列表不能为空');
    }

    if (suppliers.length > 100) {
      throw new BadRequestException('一次最多只能创建100个供应商账号');
    }

    const results = {
      success: [] as any[],
      failed: [] as Array<{ email: string; reason: string }>,
    };

    // 检查所有邮箱是否已存在
    const emails = suppliers.map(s => s.email);
    const existingUsers = await this.prisma.user.findMany({
      where: {
        email: { in: emails },
      },
      select: { email: true },
    });

    const existingEmails = new Set(existingUsers.map(u => u.email));

    // 批量创建供应商账号
    for (const supplierDto of suppliers) {
      try {
        // 检查邮箱是否已存在
        if (existingEmails.has(supplierDto.email)) {
          results.failed.push({
            email: supplierDto.email,
            reason: '邮箱已被使用',
          });
          continue;
        }

        // 加密密码
        const hashedPassword = await bcrypt.hash(supplierDto.password, 10);

        // 创建供应商账号
        const supplier = await this.prisma.user.create({
          data: {
            email: supplierDto.email,
            username: supplierDto.username,
            password: hashedPassword,
            role: 'SUPPLIER',
            status: supplierDto.status || 'ACTIVE',
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

        results.success.push(supplier);
        existingEmails.add(supplierDto.email); // 避免同一批次内重复
      } catch (error: any) {
        results.failed.push({
          email: supplierDto.email,
          reason: error.message || '创建失败',
        });
      }
    }

    return {
      total: suppliers.length,
      success: results.success.length,
      failed: results.failed.length,
      results,
    };
  }

  /**
   * 获取所有供应商账号列表
   */
  async getSuppliers() {
    return this.prisma.user.findMany({
      where: {
        role: 'SUPPLIER',
      },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * 获取待审核的注册申请
   */
  async getPendingRegistrations() {
    const pendingUsers = await this.prisma.user.findMany({
      where: {
        status: 'PENDING',
        role: { in: ['STORE', 'SUPPLIER'] },
      },
      include: {
        store: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return pendingUsers.map(user => ({
      id: user.id,
      email: user.email,
      username: user.username,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      store: user.store ? {
        id: user.store.id,
        name: user.store.name,
        code: user.store.code,
        address: user.store.address,
        contact: user.store.contact,
      } : null,
    }));
  }

  /**
   * 审核通过用户注册
   */
  async approveUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (user.status !== 'PENDING') {
      throw new BadRequestException('该用户不在待审核状态');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'ACTIVE' },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  /**
   * 拒绝用户注册
   */
  async rejectUser(userId: string, reason?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (user.status !== 'PENDING') {
      throw new BadRequestException('该用户不在待审核状态');
    }

    // 拒绝时设置为 SUSPENDED 状态
    return this.prisma.user.update({
      where: { id: userId },
      data: { status: 'SUSPENDED' },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  /**
   * 更新供应商账号状态
   */
  async updateSupplierStatus(supplierId: string, status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') {
    // 检查供应商是否存在
    const supplier = await this.prisma.user.findUnique({
      where: { id: supplierId },
    });

    if (!supplier) {
      throw new BadRequestException('供应商账号不存在');
    }

    if (supplier.role !== 'SUPPLIER') {
      throw new BadRequestException('该账号不是供应商账号');
    }

    // 更新状态
    return this.prisma.user.update({
      where: { id: supplierId },
      data: { status },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        status: true,
        updatedAt: true,
      },
    });
  }

  /**
   * 删除供应商账号（软删除：设置为 INACTIVE）
   */
  async deleteSupplier(supplierId: string) {
    return this.updateSupplierStatus(supplierId, 'INACTIVE');
  }
}

