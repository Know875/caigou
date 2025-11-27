import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { StoreService } from './store.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('门店')
@Controller('stores')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class StoreController {
  constructor(private storeService: StoreService) {}

  @Get()
  @ApiOperation({ summary: '获取门店列表' })
  async findAll(@Request() req) {
    // 门店用户只能看到自己的店铺
    if (req.user.role === 'STORE' && req.user.storeId) {
      const store = await this.storeService.findOne(req.user.storeId);
      return store ? [store] : [];
    }
    // 管理员和采购员可以看到所有门店
    return this.storeService.findAll();
  }

  @Post()
  @ApiOperation({ summary: '创建门店' })
  create(@Body() data: { name: string; code: string; address?: string; contact?: string }) {
    return this.storeService.create(data);
  }

  @Get(':id')
  @ApiOperation({ summary: '获取门店详情' })
  findOne(@Param('id') id: string) {
    return this.storeService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除门店' })
  async remove(@Param('id') id: string, @Request() req) {
    // 检查是否为管理员
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('仅管理员可操作');
    }
    return this.storeService.remove(id);
  }
}

