import { Controller, Get, UseGuards, Query, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ReportService } from './report.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { getStoreFilter } from '../../common/utils/store-filter.util';

@ApiTags('报表')
@Controller('reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportController {
  constructor(private reportService: ReportService) {}

  @Get('auction-savings')
  @ApiOperation({ summary: '竞价节省率' })
  getAuctionSavings(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportService.getAuctionSavingsRate(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('on-time-rate')
  @ApiOperation({ summary: '准时交付率' })
  getOnTimeRate(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportService.getOnTimeRate(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('after-sales-rate')
  @ApiOperation({ summary: '售后处理率' })
  getAfterSalesRate(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportService.getAfterSalesRate(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('responsibility-distribution')
  @ApiOperation({ summary: '责任分布' })
  getResponsibilityDistribution(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.reportService.getResponsibilityDistribution(
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @Get('financial')
  @ApiOperation({ summary: '财务报表（支持日报、周报、月报）' })
  async getFinancialReport(
    @Query('date') date?: string,
    @Query('storeId') storeId?: string,
    @Query('period') period?: 'day' | 'week' | 'month',
    @Req() req?: any,
  ) {
    try {
      // ADMIN可以看到所有门店的财务报表
      // 门店用户只能查看自己门店的财务报表
      const storeFilter = getStoreFilter(req?.user || {});
      const finalStoreId = req?.user?.role === 'ADMIN' ? storeId : (storeFilter.storeId || storeId);

      // 传递用户信息到Service层进行权限验证
      const result = await this.reportService.getFinancialReport(
        date ? new Date(date) : undefined,
        finalStoreId,
        period || 'day',
        req?.user, // 传递用户信息
      );

      return result;
    } catch (error: any) {
      // 这里直接抛给全局异常过滤器处理
      console.error('[ReportController] getFinancialReport 错误:', error);
      throw error;
    }
  }

  @Get('supplier-financial')
  @ApiOperation({ summary: '供应商财务看板' })
  getSupplierFinancialDashboard(
    @Req() req: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('supplierId') supplierId?: string, // 管理员和采购员可以指定供应商ID
  ) {
    // 供应商只能查看自己的财务数据
    if (req.user.role === 'SUPPLIER') {
      return this.reportService.getSupplierFinancialDashboard(
        req.user.id,
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined,
      );
    }

    // 管理员和采购员可以查看所有供应商的财务数据
    if (req.user.role === 'ADMIN' || req.user.role === 'BUYER') {
      // 如果指定了 supplierId，查看该供应商的数据；否则查看所有供应商的数据（汇总）
      if (supplierId) {
        return this.reportService.getSupplierFinancialDashboard(
          supplierId,
          startDate ? new Date(startDate) : undefined,
          endDate ? new Date(endDate) : undefined,
        );
      }

      return this.reportService.getAllSuppliersFinancialDashboard(
        startDate ? new Date(startDate) : undefined,
        endDate ? new Date(endDate) : undefined,
      );
    }

    throw new Error('无权访问');
  }

  // （可选）如果想单独给管理员一个“所有供应商财务看板”的路由，也可以解开这个：
  // @Get('suppliers-financial')
  // @ApiOperation({ summary: '所有供应商财务看板（管理员）' })
  // getAllSuppliersFinancialDashboard(
  //   @Query('startDate') startDate?: string,
  //   @Query('endDate') endDate?: string,
  // ) {
  //   return this.reportService.getAllSuppliersFinancialDashboard(
  //     startDate ? new Date(startDate) : undefined,
  //     endDate ? new Date(endDate) : undefined,
  //   );
  // }
}
