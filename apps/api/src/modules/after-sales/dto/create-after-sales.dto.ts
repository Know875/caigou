import { IsString, IsEnum, IsOptional, IsNumber, IsDecimal } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateAfterSalesDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  orderId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  shipmentId?: string;

  @ApiProperty({ required: false, description: '快递单号（用于自动定位供应商或电商平台）' })
  @IsOptional()
  @IsString()
  trackingNo?: string;

  @ApiProperty({ enum: ['DAMAGED', 'MISSING', 'WRONG_ITEM', 'REPAIR', 'CLAIM', 'DISCOUNT', 'SCRAP'] })
  @IsEnum(['DAMAGED', 'MISSING', 'WRONG_ITEM', 'REPAIR', 'CLAIM', 'DISCOUNT', 'SCRAP'])
  type: string;

  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' })
  @IsEnum(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority: string;

  @ApiProperty()
  @IsString()
  description: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  supplierId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  claimAmount?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  inventoryDisposition?: string;

  @ApiProperty({ required: false, description: '门店ID' })
  @IsOptional()
  @IsString()
  storeId?: string;
}

