import { IsString, IsNotEmpty, IsNumber, IsOptional, IsEnum, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum BoxCondition {
  WITH_SHIPPING_BOX = 'WITH_SHIPPING_BOX',      // 带运输盒
  NEW_UNOPENED = 'NEW_UNOPENED',                // 全新未拆封
  COLOR_BOX_ONLY = 'COLOR_BOX_ONLY',           // 仅彩盒
  MINOR_DAMAGE = 'MINOR_DAMAGE',                // 轻微盒损
  SEVERE_DAMAGE = 'SEVERE_DAMAGE',             // 严重盒损
  OPENED_SECONDHAND = 'OPENED_SECONDHAND',      // 已拆二手
}

export class CreateInventoryDto {
  @ApiProperty({ description: '货名（必填）' })
  @IsString()
  @IsNotEmpty()
  productName: string;

  @ApiProperty({ description: '价格（必填）' })
  @IsNumber()
  @Min(0.01)
  price: number;

  @ApiProperty({ description: '数量（必填）' })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ 
    description: '盒况（可选）',
    enum: BoxCondition,
    required: false,
  })
  @IsOptional()
  @IsEnum(BoxCondition)
  boxCondition?: BoxCondition;

  @ApiProperty({ description: '描述（可选）', required: false })
  @IsOptional()
  @IsString()
  description?: string;
}

