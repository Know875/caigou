import { Controller, Post, Get, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateSupplierDto, CreateSuppliersDto } from './dto/create-supplier.dto';

@ApiTags('管理员')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles('ADMIN')
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Post('clear-all-data')
  @ApiOperation({ summary: '清除所有数据（仅管理员）' })
  clearAllData(@Request() req) {
    return this.adminService.clearAllData();
  }

  @Post('suppliers')
  @ApiOperation({ summary: '创建单个供应商账号' })
  createSupplier(@Body() createSupplierDto: CreateSupplierDto) {
    return this.adminService.createSupplier(createSupplierDto);
  }

  @Post('suppliers/batch')
  @ApiOperation({ summary: '批量创建供应商账号' })
  createSuppliers(@Body() createSuppliersDto: CreateSuppliersDto) {
    return this.adminService.createSuppliers(createSuppliersDto);
  }

  @Get('suppliers')
  @ApiOperation({ summary: '获取所有供应商账号列表' })
  @Roles('ADMIN', 'BUYER') // 管理员和采购员都可以查看供应商列表
  getSuppliers(@Request() req) {
    // 双重检查：确保只有管理员和采购员可以访问
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new ForbiddenException('仅管理员和采购员可访问');
    }
    return this.adminService.getSuppliers();
  }

  @Patch('suppliers/:id/status')
  @ApiOperation({ summary: '更新供应商账号状态' })
  updateSupplierStatus(
    @Param('id') id: string,
    @Body('status') status: 'PENDING' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  ) {
    return this.adminService.updateSupplierStatus(id, status);
  }

  @Get('pending-registrations')
  @ApiOperation({ summary: '获取待审核的注册申请（门店和供应商）' })
  getPendingRegistrations() {
    return this.adminService.getPendingRegistrations();
  }

  @Patch('users/:id/approve')
  @ApiOperation({ summary: '审核通过用户注册' })
  approveUser(@Param('id') id: string) {
    return this.adminService.approveUser(id);
  }

  @Patch('users/:id/reject')
  @ApiOperation({ summary: '拒绝用户注册' })
  rejectUser(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.adminService.rejectUser(id, reason);
  }

  @Delete('suppliers/:id')
  @ApiOperation({ summary: '删除供应商账号（软删除）' })
  deleteSupplier(@Param('id') id: string) {
    return this.adminService.deleteSupplier(id);
  }
}

