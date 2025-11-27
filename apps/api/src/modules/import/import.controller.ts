import { Controller, Post, Get, UseInterceptors, UploadedFile, UseGuards, Body, Request, Res, Query } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RfqService } from '../rfq/rfq.service';
import { CreateRfqDto } from '../rfq/dto/create-rfq.dto';
import { singleFileConfig } from '../../common/config/multer.config';
import { Response } from 'express';
import * as XLSX from 'xlsx';

@ApiTags('导入')
@Controller('import')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ImportController {
  constructor(
    private rfqService: RfqService,
  ) {}

  @Post('products')
  @UseInterceptors(FileInterceptor('file', singleFileConfig))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '导入商品并创建询价单（Excel/CSV）' })
  async importProductsAndCreateRfq(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: any,
    @Request() req,
  ) {
    // 供应商不能导入商品并创建询价单
    if (req.user.role === 'SUPPLIER') {
      throw new Error('供应商无权导入商品并创建询价单');
    }
    // 从body中提取询价单参数
    const createRfqDto: CreateRfqDto = {
      title: body.title || `询价单-${new Date().toLocaleDateString('zh-CN')}`,
      description: body.description || '',
      type: body.type || 'NORMAL',
      deadline: body.deadline || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 默认24小时后
      storeId: body.storeId || undefined,
    };
    
    // 直接调用RFQ服务的createFromFile方法
    return this.rfqService.createFromFile(file, createRfqDto, req.user.id);
  }

  @Get('template')
  @ApiOperation({ summary: '下载导入模板（Excel）' })
  async downloadTemplate(
    @Query('type') type: string = 'products',
    @Res() res: Response,
  ) {
    try {
      console.log(`[ImportController] 下载模板请求: type=${type}`);
      let headers: string[] = [];
      let data: any[] = [];
      let filename = '';

      if (type === 'products') {
        // 商品导入模板（包含可选字段，表头标注必填/可选）
        headers = [
          '订单号(可选)',
          '订单时间(可选)',
          '货名(必填)',
          '数量(必填)',
          '单位(可选)',
          '价格(可选)',
          '最高限价(可选)',
          '一口价(可选)',
          '收件人(可选)',
          '手机号(可选)',
          '地址(可选)',
          '修改地址(可选)',
          'openid(可选)',
          '用户昵称(可选)',
          '描述(可选)',
          '备注(可选)',
          '积分(可选)',
        ];
        // 注意：数据对象的键名需要匹配表头顺序
        data = [
          {
            '订单号(可选)': 'ORD001',
            '订单时间(可选)': '2025-01-21',
            '货名(必填)': '示例商品1',
            '数量(必填)': 10,
            '单位(可选)': '个',
            '价格(可选)': 199.0,
            '最高限价(可选)': 250.0,
            '一口价(可选)': 200.0,
            '收件人(可选)': '张三',
            '手机号(可选)': '13800138000',
            '地址(可选)': '北京市朝阳区xxx街道xxx号',
            '修改地址(可选)': '',
            'openid(可选)': 'openid123456',
            '用户昵称(可选)': '张三',
            '描述(可选)': '这是商品1的描述',
            '备注(可选)': '这是备注信息',
            '积分(可选)': 100,
          },
          {
            '订单号(可选)': '',
            '订单时间(可选)': '',
            '货名(必填)': '示例商品2',
            '数量(必填)': 5,
            '单位(可选)': '件',
            '价格(可选)': '',
            '最高限价(可选)': 150.0,
            '一口价(可选)': '',
            '收件人(可选)': '',
            '手机号(可选)': '',
            '地址(可选)': '',
            '修改地址(可选)': '',
            'openid(可选)': '',
            '用户昵称(可选)': '',
            '描述(可选)': '这是商品2的描述',
            '备注(可选)': '',
            '积分(可选)': '',
          },
          {
            '订单号(可选)': 'ORD002',
            '订单时间(可选)': '2025-01-21',
            '货名(必填)': '示例商品3',
            '数量(必填)': 20,
            '单位(可选)': '套',
            '价格(可选)': 299.0,
            '最高限价(可选)': 350.0,
            '一口价(可选)': 280.0,
            '收件人(可选)': '李四',
            '手机号(可选)': '13900139000',
            '地址(可选)': '上海市浦东新区xxx路xxx号',
            '修改地址(可选)': '上海市浦东新区yyy路yyy号',
            'openid(可选)': 'openid789012',
            '用户昵称(可选)': '李四',
            '描述(可选)': '这是商品3的描述',
            '备注(可选)': '重要商品',
            '积分(可选)': 200,
          },
        ];
        filename = '商品导入模板.xlsx';
      } else if (type === 'history') {
        // 历史订单导入模板（表头标注必填/可选）
        headers = [
          '发货编号(可选)',
          '订单号(可选)',
          'open_id(可选)',
          '收件人(可选)',
          '手机号(可选)',
          '地址(可选)',
          '修改地址(可选)',
          '货名(必填)',
          '数量(必填)',
          '机台标价(可选)',
          '积分(可选)',
          '状态(可选)',
          '日期(可选)',
          '备注(可选)',
          '快递单号(可选)',
          '成本价(可选)',
        ];
        data = [
          {
            '发货编号(可选)': 'SH001',
            '订单号(可选)': 'ORD001',
            'open_id(可选)': 'openid123456',
            '收件人(可选)': '张三',
            '手机号(可选)': '13800138000',
            '地址(可选)': '北京市朝阳区xxx街道xxx号',
            '修改地址(可选)': '',
            '货名(必填)': '模型玩具A',
            '数量(必填)': 2,
            '机台标价(可选)': 199.0,
            '积分(可选)': 100,
            '状态(可选)': '已发货',
            '日期(可选)': '2025-01-21',
            '备注(可选)': '包装完好',
            '快递单号(可选)': 'SF1234567890',
            '成本价(可选)': 150.0,
          },
          {
            '发货编号(可选)': 'SH002',
            '订单号(可选)': 'ORD002',
            'open_id(可选)': 'openid789012',
            '收件人(可选)': '李四',
            '手机号(可选)': '13900139000',
            '地址(可选)': '上海市浦东新区xxx路xxx号',
            '修改地址(可选)': '上海市浦东新区yyy路yyy号',
            '货名(必填)': '模型玩具B',
            '数量(必填)': 1,
            '机台标价(可选)': 299.0,
            '积分(可选)': 200,
            '状态(可选)': '已发货',
            '日期(可选)': '2025-01-21',
            '备注(可选)': '注意轻放',
            '快递单号(可选)': 'YT9876543210',
            '成本价(可选)': 220.0,
          },
        ];
        filename = '历史订单导入模板.xlsx';
      } else if (type === 'inventory') {
        // 库存导入模板（表头标注必填/可选）
        headers = [
          '货名(必填)',
          '价格(必填)',
          '数量(必填)',
          '盒况(可选)',
          '描述(可选)',
        ];
        data = [
          {
            '货名(必填)': '示例商品1',
            '价格(必填)': 199.0,
            '数量(必填)': 10,
            '盒况(可选)': '带运输盒',
            '描述(可选)': '这是商品1的描述',
          },
          {
            '货名(必填)': '示例商品2',
            '价格(必填)': 299.0,
            '数量(必填)': 5,
            '盒况(可选)': '全新未拆封',
            '描述(可选)': '这是商品2的描述',
          },
          {
            '货名(必填)': '示例商品3',
            '价格(必填)': 399.0,
            '数量(必填)': 20,
            '盒况(可选)': '',
            '描述(可选)': '这是商品3的描述',
          },
        ];
        filename = '库存导入模板.xlsx';
      } else {
        return res.status(400).json({ message: '无效的模板类型' });
      }

      // 创建工作簿
      const workbook = XLSX.utils.book_new();
      
      // 创建工作表数据（包含表头）
      const worksheetData = [headers, ...data.map(row => headers.map(header => row[header] || ''))];
      
      // 创建工作表
      const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
      
      // 设置列宽
      const colWidths = headers.map(() => ({ wch: 15 }));
      worksheet['!cols'] = colWidths;
      
      // 设置表头样式（加粗）
      const headerRange = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
      for (let col = headerRange.s.c; col <= headerRange.e.c; col++) {
        const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
        if (!worksheet[cellAddress]) continue;
        worksheet[cellAddress].s = {
          font: { bold: true },
          fill: { fgColor: { rgb: 'E0E0E0' } },
          alignment: { horizontal: 'center', vertical: 'center' },
        };
      }
      
      // 将工作表添加到工作簿
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      
      // 生成 Excel 文件缓冲区
      console.log(`[ImportController] 开始生成 Excel 文件: filename=${filename}`);
      const excelBuffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx',
      });
      
      console.log(`[ImportController] Excel 文件生成成功，大小: ${excelBuffer.length} bytes`);
      
      // 设置响应头（支持中文文件名）
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Length', excelBuffer.length.toString());
      
      // 使用 RFC 5987 格式支持中文文件名
      // 先尝试使用 UTF-8 编码的文件名
      const encodedFilename = encodeURIComponent(filename);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`
      );
      
      // 添加 CORS 头（如果需要）
      res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
      
      console.log(`[ImportController] 响应头设置完成，开始发送文件`);
      
      // 发送文件
      res.send(excelBuffer);
      
      console.log(`[ImportController] 文件发送完成`);
    } catch (error) {
      console.error('生成模板文件失败:', error);
      const errorMessage = error instanceof Error ? error.message : '生成模板文件失败';
      // 确保错误响应时没有设置文件下载相关的响应头
      if (!res.headersSent) {
        res.status(500).json({ 
          message: '生成模板文件失败',
          error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        });
      }
    }
  }

}

