import { IsString, IsNumber, IsOptional, IsDecimal, IsArray, ValidateNested, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class QuoteItemDto {
  @ApiProperty()
  @IsString()
  rfqItemId: string; // 询价单商品ID

  @ApiProperty()
  @IsNumber()
  @Min(0.01, { message: '商品价格必须大于0' })
  price: number; // 该商品的报价单价

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryDays?: number; // 该商品的交付天数

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string; // 该商品的备注
}

export class CreateQuoteDto {
  @ApiProperty()
  @IsString()
  rfqId: string;

  @ApiProperty()
  @IsNumber()
  @Min(0.01, { message: '总价必须大于0' })
  price: number; // 总价（所有商品报价的总和，用于快速计算）

  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  deliveryDays?: number; // 整体交付天数

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string; // 整体备注

  @ApiProperty({ required: false, type: [QuoteItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteItemDto)
  items?: QuoteItemDto[]; // 商品级别的报价明细
}
