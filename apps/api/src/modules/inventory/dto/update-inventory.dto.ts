import { PartialType } from '@nestjs/swagger';
import { CreateInventoryDto } from './create-inventory.dto';
import { IsOptional, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum InventoryStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  SOLD_OUT = 'SOLD_OUT',
}

export class UpdateInventoryDto extends PartialType(CreateInventoryDto) {
  @ApiProperty({ 
    description: '状态（可选）',
    enum: InventoryStatus,
    required: false,
  })
  @IsOptional()
  @IsEnum(InventoryStatus)
  status?: InventoryStatus;
}

