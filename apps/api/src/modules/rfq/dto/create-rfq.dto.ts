import { IsString, IsDateString, IsOptional, IsArray, IsEnum, ValidateNested, IsInt, Min, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class RfqItemDto {
  @ApiProperty()
  @IsString()
  productName: string;

  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false, description: '最高限价（供应商报价不能超过此价格）' })
  @IsOptional()
  @IsNumber()
  @Min(0.01, { message: '最高限价必须大于0' })
  maxPrice?: number;

  @ApiProperty({ required: false, description: '一口价（供应商报价<=此价格时自动中标）' })
  @IsOptional()
  @IsNumber()
  @Min(0.01, { message: '一口价必须大于0' })
  instantPrice?: number;
}

export class CreateRfqDto {
  @ApiProperty()
  @IsString()
  title: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: ['AUCTION', 'FIXED_PRICE', 'NORMAL'] })
  @IsEnum(['AUCTION', 'FIXED_PRICE', 'NORMAL'])
  type: string;

  @ApiProperty()
  @IsDateString()
  deadline: string;

  @ApiProperty({ description: '关联门店（必填）' })
  @IsString({ message: '门店ID不能为空' })
  storeId: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  orderIds?: string[];

  @ApiProperty({ required: false, type: [RfqItemDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RfqItemDto)
  items?: RfqItemDto[];
}

