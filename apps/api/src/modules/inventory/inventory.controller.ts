import { Controller, Get, Post, Body, Patch, Param, Delete, UseGuards, Request, Query, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { CreateInventoryDto } from './dto/create-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { singleFileConfig } from '../../common/config/multer.config';

@ApiTags('库存管理')
@Controller('inventory')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Post()
  @ApiOperation({ summary: '创建库存（供应商）' })
  create(@Body() createInventoryDto: CreateInventoryDto, @Request() req) {
    // 只有供应商可以创建库存
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('只有供应商可以创建库存');
    }
    return this.inventoryService.create(req.user.id, createInventoryDto);
  }

  @Get('supplier')
  @ApiOperation({ summary: '获取供应商的库存列表' })
  findBySupplier(@Request() req, @Query('status') status?: string, @Query('search') search?: string) {
    // 只有供应商可以查看自己的库存
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('只有供应商可以查看库存');
    }
    return this.inventoryService.findBySupplier(req.user.id, { status, search });
  }

  @Get('available')
  @ApiOperation({ summary: '获取所有供应商的现货库存（门店端，隐藏供应商信息）' })
  findAllAvailable(
    @Query('search') search?: string,
    @Query('boxCondition') boxCondition?: string,
    @Query('minPrice') minPrice?: string,
    @Query('maxPrice') maxPrice?: string,
  ) {
    // 允许管理员、采购员、门店用户查看现货库存
    const filters: any = {};
    if (search) filters.search = search;
    if (boxCondition) filters.boxCondition = boxCondition;
    if (minPrice) filters.minPrice = parseFloat(minPrice);
    if (maxPrice) filters.maxPrice = parseFloat(maxPrice);
    
    return this.inventoryService.findAllAvailable(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取库存详情' })
  findOne(@Param('id') id: string, @Request() req) {
    // 供应商只能查看自己的库存，管理员和采购员可以查看所有
    const supplierId = req.user.role === 'SUPPLIER' ? req.user.id : undefined;
    return this.inventoryService.findOne(id, supplierId);
  }

  @Patch(':id')
  @ApiOperation({ summary: '更新库存（供应商）' })
  update(@Param('id') id: string, @Body() updateInventoryDto: UpdateInventoryDto, @Request() req) {
    // 只有供应商可以更新自己的库存
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('只有供应商可以更新库存');
    }
    return this.inventoryService.update(id, req.user.id, updateInventoryDto);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除库存（供应商）' })
  remove(@Param('id') id: string, @Request() req) {
    // 只有供应商可以删除自己的库存
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('只有供应商可以删除库存');
    }
    return this.inventoryService.remove(id, req.user.id);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '批量导入库存（Excel/CSV）' })
  async importInventory(
    @UploadedFile() file: Express.Multer.File,
    @Request() req,
  ) {
    // 只有供应商可以导入库存
    if (req.user.role !== 'SUPPLIER') {
      throw new Error('只有供应商可以导入库存');
    }
    return this.inventoryService.importFromFile(file, req.user.id);
  }
}

