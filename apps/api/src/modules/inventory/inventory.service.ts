import { Injectable, NotFoundException, ForbiddenException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import * as XLSX from 'xlsx';
import * as csv from 'csv-parse/sync';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * 创建库存（供应商）
   */
  async create(supplierId: string, createInventoryDto: CreateInventoryDto) {
    return this.prisma.supplierInventory.create({
      data: {
        supplierId,
        productName: createInventoryDto.productName,
        price: createInventoryDto.price,
        quantity: createInventoryDto.quantity,
        boxCondition: createInventoryDto.boxCondition,
        description: createInventoryDto.description,
        status: 'ACTIVE',
      },
      include: {
        supplier: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * 获取供应商的库存列表
   */
  async findBySupplier(supplierId: string, filters?: { status?: string; search?: string }) {
    const where: any = {
      supplierId,
    };

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.search) {
      where.productName = {
        contains: filters.search,
      };
    }

    return this.prisma.supplierInventory.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
      include: {
        supplier: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * 获取所有供应商的现货库存（门店端，隐藏供应商信息）
   */
  async findAllAvailable(filters?: { search?: string; boxCondition?: string; minPrice?: number; maxPrice?: number }) {
    const where: any = {
      status: 'ACTIVE',
      quantity: {
        gt: 0,
      },
    };

    if (filters?.search) {
      where.productName = {
        contains: filters.search,
      };
    }

    if (filters?.boxCondition) {
      where.boxCondition = filters.boxCondition;
    }

    if (filters?.minPrice !== undefined) {
      where.price = {
        ...where.price,
        gte: filters.minPrice,
      };
    }

    if (filters?.maxPrice !== undefined) {
      where.price = {
        ...where.price,
        lte: filters.maxPrice,
      };
    }

    const inventories = await this.prisma.supplierInventory.findMany({
      where,
      orderBy: {
        updatedAt: 'desc',
      },
      select: {
        id: true,
        productName: true,
        price: true,
        quantity: true,
        boxCondition: true,
        description: true,
        createdAt: true,
        updatedAt: true,
        supplierId: true, // 需要返回供应商ID用于下单
        // 不包含 supplier 详细信息，隐藏供应商名称
      },
    });

    return inventories;
  }

  /**
   * 获取单个库存详情
   */
  async findOne(id: string, supplierId?: string) {
    const inventory = await this.prisma.supplierInventory.findUnique({
      where: { id },
      include: {
        supplier: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });

    if (!inventory) {
      throw new NotFoundException('库存不存在');
    }

    // 如果指定了供应商ID，检查权限
    if (supplierId && inventory.supplierId !== supplierId) {
      throw new ForbiddenException('无权访问此库存');
    }

    return inventory;
  }

  /**
   * 更新库存（供应商）
   */
  async update(id: string, supplierId: string, updateInventoryDto: UpdateInventoryDto) {
    // 检查库存是否存在且属于该供应商
    const inventory = await this.prisma.supplierInventory.findUnique({
      where: { id },
    });

    if (!inventory) {
      throw new NotFoundException('库存不存在');
    }

    if (inventory.supplierId !== supplierId) {
      throw new ForbiddenException('无权修改此库存');
    }

    // 如果更新数量为0，自动设置为已售罄
    if (updateInventoryDto.quantity !== undefined && updateInventoryDto.quantity === 0) {
      updateInventoryDto.status = 'SOLD_OUT' as any;
    }

    return this.prisma.supplierInventory.update({
      where: { id },
      data: updateInventoryDto,
      include: {
        supplier: {
          select: {
            id: true,
            username: true,
            email: true,
          },
        },
      },
    });
  }

  /**
   * 删除库存（供应商）
   */
  async remove(id: string, supplierId: string) {
    // 检查库存是否存在且属于该供应商
    const inventory = await this.prisma.supplierInventory.findUnique({
      where: { id },
    });

    if (!inventory) {
      throw new NotFoundException('库存不存在');
    }

    if (inventory.supplierId !== supplierId) {
      throw new ForbiddenException('无权删除此库存');
    }

    return this.prisma.supplierInventory.delete({
      where: { id },
    });
  }

  /**
   * 批量更新库存数量（用于下单后扣减）
   */
  async updateQuantities(updates: Array<{ id: string; quantity: number }>) {
    const results = [];
    for (const update of updates) {
      try {
        const inventory = await this.prisma.supplierInventory.findUnique({
          where: { id: update.id },
        });

        if (!inventory) {
          results.push({ id: update.id, success: false, error: '库存不存在' });
          continue;
        }

        const newQuantity = inventory.quantity - update.quantity;
        if (newQuantity < 0) {
          results.push({ id: update.id, success: false, error: '库存不足' });
          continue;
        }

        await this.prisma.supplierInventory.update({
          where: { id: update.id },
          data: {
            quantity: newQuantity,
            status: newQuantity === 0 ? 'SOLD_OUT' : inventory.status,
          },
        });

        results.push({ id: update.id, success: true });
      } catch (error) {
        results.push({ 
          id: update.id, 
          success: false, 
          error: error instanceof Error ? error.message : '更新失败' 
        });
      }
    }
    return results;
  }

  /**
   * 从文件批量导入库存
   */
  async importFromFile(
    file: Express.Multer.File,
    supplierId: string,
  ): Promise<{
    totalRows: number;
    successRows: number;
    errorRows: number;
    errors: Array<{ row: number; data: any; error: string }>;
  }> {
    try {
      // 验证文件
      if (!file || !file.buffer) {
        throw new BadRequestException('文件不能为空');
      }

      // 解析文件
      const rows = await this.parseInventoryFile(file);
      const errors: Array<{ row: number; data: any; error: string }> = [];
      let successCount = 0;

      this.logger.log('开始导入库存数据', {
        filename: file.originalname,
        supplierId,
        totalRows: rows.length,
      });

      // 批量导入
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        try {
          await this.importInventoryRow(row, supplierId, i + 1);
          successCount++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({
            row: i + 1,
            data: row,
            error: errorMessage,
          });
          // 记录单个行错误，但不中断整个导入流程
          this.logger.warn('导入库存数据行失败', {
            row: i + 1,
            supplierId,
            error: errorMessage,
          });
        }
      }

      this.logger.log('库存导入完成', {
        filename: file.originalname,
        supplierId,
        totalRows: rows.length,
        successRows: successCount,
        errorRows: errors.length,
      });

      return {
        totalRows: rows.length,
        successRows: successCount,
        errorRows: errors.length,
        errors,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('导入库存数据失败', {
        filename: file?.originalname,
        supplierId,
        error: errorMessage,
      });
      throw new BadRequestException(`导入失败：${errorMessage}`);
    }
  }

  /**
   * 解析库存导入文件
   */
  private async parseInventoryFile(file: Express.Multer.File): Promise<Record<string, unknown>[]> {
    const ext = file.originalname.split('.').pop()?.toLowerCase();
    let rows: Record<string, unknown>[] = [];

    this.logger.debug('开始解析文件', { ext, size: file.size });

    if (!ext) {
      throw new BadRequestException('文件缺少扩展名，无法识别文件格式');
    }

    if (ext === 'xlsx' || ext === 'xls') {
      try {
        this.logger.debug('解析 Excel 文件');
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
          throw new BadRequestException('Excel 文件不包含任何工作表');
        }
        
        const sheetName = workbook.SheetNames[0];
        this.logger.debug('工作表名称', { sheetName });
        const worksheet = workbook.Sheets[sheetName];
        
        if (!worksheet) {
          throw new BadRequestException(`无法读取工作表 "${sheetName}"`);
        }
        
        rows = XLSX.utils.sheet_to_json(worksheet);
        this.logger.debug('Excel 解析结果', { rowsCount: rows.length });
        if (rows.length > 0 && process.env.NODE_ENV === 'development') {
          this.logger.debug('第一行数据示例', { firstRow: rows[0] });
        }
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        this.logger.error('Excel 文件解析失败', {
          filename: file.originalname,
          error: errorMessage,
        });
        throw new BadRequestException(`Excel 文件解析失败：${errorMessage}。请确保文件格式正确且未被损坏`);
      }
    } else if (ext === 'csv') {
      try {
        this.logger.debug('解析 CSV 文件');
        const csvData = file.buffer.toString('utf-8');
        rows = csv.parse(csvData, {
          columns: true,
          skip_empty_lines: true,
          trim: true,
          bom: true, // 处理 UTF-8 BOM
        });
        this.logger.debug('CSV 解析结果', { rowsCount: rows.length });
        if (rows.length > 0 && process.env.NODE_ENV === 'development') {
          this.logger.debug('第一行数据示例', { firstRow: rows[0] });
        }
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        this.logger.error('CSV 文件解析失败', {
          filename: file.originalname,
          error: errorMessage,
        });
        throw new BadRequestException(`CSV 文件解析失败：${errorMessage}。请检查文件格式是否正确`);
      }
    } else {
      throw new BadRequestException(`不支持的文件格式 "${ext}"，请使用 Excel (.xlsx, .xls) 或 CSV 格式`);
    }

    if (!rows || rows.length === 0) {
      throw new BadRequestException('文件中没有有效数据。请检查文件格式是否正确');
    }

    return rows;
  }

  /**
   * 导入单行库存数据
   */
  private async importInventoryRow(
    row: Record<string, unknown>,
    supplierId: string,
    rowNumber: number,
  ): Promise<void> {
    // 字段映射：支持带括号和不带括号的字段名
    const getFieldValue = (fieldName: string): string | undefined => {
      // 先尝试直接匹配
      if (row[fieldName] !== undefined && row[fieldName] !== null && row[fieldName] !== '') {
        return String(row[fieldName]).trim();
      }
      // 尝试匹配带括号的字段名
      const fieldWithBracket = `${fieldName}(必填)`;
      if (row[fieldWithBracket] !== undefined && row[fieldWithBracket] !== null && row[fieldWithBracket] !== '') {
        return String(row[fieldWithBracket]).trim();
      }
      const fieldWithOptional = `${fieldName}(可选)`;
      if (row[fieldWithOptional] !== undefined && row[fieldWithOptional] !== null && row[fieldWithOptional] !== '') {
        return String(row[fieldWithOptional]).trim();
      }
      return undefined;
    };

    // 提取字段值
    const productName = getFieldValue('货名');
    const priceStr = getFieldValue('价格');
    const quantityStr = getFieldValue('数量');
    const boxCondition = getFieldValue('盒况');
    const description = getFieldValue('描述');

    // 验证必填字段
    if (!productName || productName.trim() === '') {
      throw new BadRequestException(`第 ${rowNumber} 行：货名不能为空`);
    }

    if (!priceStr || priceStr.trim() === '') {
      throw new BadRequestException(`第 ${rowNumber} 行：价格不能为空`);
    }

    if (!quantityStr || quantityStr.trim() === '') {
      throw new BadRequestException(`第 ${rowNumber} 行：数量不能为空`);
    }

    // 解析价格和数量
    const price = parseFloat(priceStr);
    if (isNaN(price) || price <= 0) {
      throw new BadRequestException(`第 ${rowNumber} 行：价格必须是大于0的数字`);
    }

    const quantity = parseInt(quantityStr, 10);
    if (isNaN(quantity) || quantity < 1) {
      throw new BadRequestException(`第 ${rowNumber} 行：数量必须是大于0的整数`);
    }

    // 验证盒况（如果提供）
    let boxConditionEnum: string | undefined;
    if (boxCondition && boxCondition.trim() !== '') {
      // 支持中文和英文枚举值
      const boxConditionMap: Record<string, string> = {
        '带运输盒': 'WITH_SHIPPING_BOX',
        '全新未拆封': 'NEW_UNOPENED',
        '仅彩盒': 'COLOR_BOX_ONLY',
        '轻微盒损': 'MINOR_DAMAGE',
        '严重盒损': 'SEVERE_DAMAGE',
        '已拆二手': 'OPENED_SECONDHAND',
        'WITH_SHIPPING_BOX': 'WITH_SHIPPING_BOX',
        'NEW_UNOPENED': 'NEW_UNOPENED',
        'COLOR_BOX_ONLY': 'COLOR_BOX_ONLY',
        'MINOR_DAMAGE': 'MINOR_DAMAGE',
        'SEVERE_DAMAGE': 'SEVERE_DAMAGE',
        'OPENED_SECONDHAND': 'OPENED_SECONDHAND',
      };

      boxConditionEnum = boxConditionMap[boxCondition.trim()];
      if (!boxConditionEnum) {
        throw new BadRequestException(
          `第 ${rowNumber} 行：盒况值无效 "${boxCondition}"。有效值：带运输盒、全新未拆封、仅彩盒、轻微盒损、严重盒损、已拆二手`
        );
      }
    }

    // 创建库存
    const createDto: CreateInventoryDto = {
      productName: productName.trim(),
      price,
      quantity,
      boxCondition: boxConditionEnum as any,
      description: description?.trim() || undefined,
    };

    await this.create(supplierId, createDto);
  }
}

