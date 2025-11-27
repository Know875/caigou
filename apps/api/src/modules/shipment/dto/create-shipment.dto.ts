import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateShipmentDto {
  @ApiProperty()
  @IsString()
  orderId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  awardId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  trackingNo?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  carrier?: string;
}

