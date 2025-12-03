import { Controller, Get, Post, Body, Param, UseGuards, Request, Query, Patch, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { QuoteService } from './quote.service';
import { CreateQuoteDto } from './dto/create-quote.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('鎶ヤ环')
@Controller('quotes')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class QuoteController {
  constructor(private quoteService: QuoteService) {}

  @Post()
  @ApiOperation({ summary: '提交报价' })
  create(@Body() createQuoteDto: CreateQuoteDto, @Request() req) {
    console.log('📋 [QuoteController] 收到提交报价请求', {
      userId: req.user?.id,
      userRole: req.user?.role,
      rfqId: createQuoteDto?.rfqId,
      price: createQuoteDto?.price,
      itemsCount: createQuoteDto?.items?.length || 0,
    });
    
    // 只有供应商可以提交报价
    if (req.user.role !== 'SUPPLIER') {
      console.error('❌ [QuoteController] 权限错误：只有供应商可以提交报价', {
        userRole: req.user?.role,
        userId: req.user?.id,
      });
      throw new ForbiddenException('只有供应商可以提交报价');
    }
    
    // 调用 service 创建报价
    return this.quoteService.create(createQuoteDto, req.user.id);
  }

  @Get()
  @ApiOperation({ summary: '鑾峰彇鎶ヤ环鍒楄〃' })
  findAll(@Query() filters: any, @Request() req) {
    // 濡傛灉鏄緵搴斿晢锛屽彧杩斿洖鑷繁鐨勬姤浠?
    if (req.user.role === 'SUPPLIER') {
      return this.quoteService.findAll({ ...filters, supplierId: req.user.id });
    }
    
    // 如果是门店用户，需要确保只能看到自己门店询价单的报价
    // 通过询价单的门店ID进行过滤
    if (req.user.role === 'STORE' && req.user.storeId) {
      return this.quoteService.findAll({ ...filters, storeId: req.user.storeId });
    }
    
    return this.quoteService.findAll(filters);
  }

  @Get('previous-prices')
  @ApiOperation({ summary: '获取供应商对指定商品的历史报价（报价记忆）' })
  getPreviousPrices(
    @Query('productName') productName: string,
    @Request() req,
  ) {
    // 只有供应商可以查询自己的历史报价
    if (req.user.role !== 'SUPPLIER') {
      throw new ForbiddenException('只有供应商可以查询历史报价');
    }
    return this.quoteService.getPreviousQuotePrices(productName, req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: '鑾峰彇鎶ヤ环璇︽儏' })
  findOne(@Param('id') id: string) {
    return this.quoteService.findOne(id);
  }

  @Patch(':rfqId/award/:quoteId')
  @ApiOperation({ summary: '选商（中标）' })
  award(
    @Param('rfqId') rfqId: string,
    @Param('quoteId') quoteId: string,
    @Request() req,
    @Body('reason') reason?: string,
  ) {
    // 只有管理员和采购员可以选商
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new ForbiddenException('仅管理员和采购员可以选商');
    }
    return this.quoteService.awardQuote(rfqId, quoteId, reason);
  }
}

