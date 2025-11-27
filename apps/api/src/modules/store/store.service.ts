import { Injectable, BadRequestException, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StoreService {
  private readonly logger = new Logger(StoreService.name);

  constructor(private prisma: PrismaService) {}

  async findAll() {
    try {
      return await this.prisma.store.findMany({
        where: {
          status: 'ACTIVE',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('查询门店列表失败', {
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('查询门店列表失败，请稍后重试');
    }
  }

  async findOne(id: string) {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('门店ID不能为空');
      }

      const store = await this.prisma.store.findUnique({
        where: { id },
      });

      if (!store) {
        throw new NotFoundException(`门店不存在：${id}`);
      }

      return store;
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('查询门店详情失败', {
        id,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('查询门店详情失败，请稍后重试');
    }
  }

  async create(data: { name: string; code: string; address?: string; contact?: string }) {
    try {
      // 验证必填字段
      if (!data.name || data.name.trim() === '') {
        throw new BadRequestException('门店名称不能为空');
      }
      if (!data.code || data.code.trim() === '') {
        throw new BadRequestException('门店代码不能为空');
      }

      // 验证门店代码是否已存在
      const existingStore = await this.prisma.store.findFirst({
        where: { code: data.code },
      });

      if (existingStore) {
        throw new BadRequestException(`门店代码 "${data.code}" 已存在`);
      }

      return await this.prisma.store.create({
        data,
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('创建门店失败', {
        data: { name: data.name, code: data.code },
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('创建门店失败，请稍后重试');
    }
  }

  async remove(id: string) {
    try {
      if (!id || id.trim() === '') {
        throw new BadRequestException('门店ID不能为空');
      }

      // 检查门店是否存在
      const store = await this.prisma.store.findUnique({
        where: { id },
      });

      if (!store) {
        throw new NotFoundException(`门店不存在：${id}`);
      }

      // 检查是否有关联的询价单
      const rfqCount = await this.prisma.rfq.count({
        where: { storeId: id },
      });

      // 检查是否有关联的订单
      const orderCount = await this.prisma.order.count({
        where: { storeId: id },
      });

      if (rfqCount > 0 || orderCount > 0) {
        throw new BadRequestException(
          `无法删除门店：该门店下还有 ${rfqCount} 个询价单和 ${orderCount} 个订单。请先处理这些关联数据。`,
        );
      }

      // 删除门店（软删除：设置为 INACTIVE）
      return await this.prisma.store.update({
        where: { id },
        data: { status: 'INACTIVE' },
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      this.logger.error('删除门店失败', {
        id,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name,
      });
      throw new InternalServerErrorException('删除门店失败，请稍后重试');
    }
  }
}

