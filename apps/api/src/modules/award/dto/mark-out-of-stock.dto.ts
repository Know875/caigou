import { IsString, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class MarkOutOfStockDto {
  @ApiProperty({ description: '缺货原因', example: '库存不足，暂时无法供货' })
  @IsString()
  reason: string;

  @ApiPropertyOptional({ description: 'RFQ Item ID（如果只标记某个商品缺货）' })
  @IsOptional()
  @IsString()
  rfqItemId?: string;
}

