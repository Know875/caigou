import { IsString, IsNumber, IsDateString, IsOptional, IsDecimal } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOrderDto {
  @ApiProperty()
  @IsString()
  orderNo: string;

  @ApiProperty()
  @IsDateString()
  orderTime: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  userNickname?: string;

  @ApiProperty()
  @IsString()
  openid: string;

  @ApiProperty()
  @IsString()
  recipient: string;

  @ApiProperty()
  @IsString()
  phone: string;

  @ApiProperty()
  @IsString()
  address: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  modifiedAddress?: string;

  @ApiProperty()
  @IsString()
  productName: string;

  @ApiProperty()
  @IsNumber()
  price: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  points?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  storeId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  buyerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  shippedAt?: string;
}

