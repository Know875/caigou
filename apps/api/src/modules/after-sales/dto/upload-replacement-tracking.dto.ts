import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadReplacementTrackingDto {
  @ApiProperty({ description: '快递单号' })
  @IsString()
  trackingNo: string;

  @ApiProperty({ description: '快递公司', required: false })
  @IsOptional()
  @IsString()
  carrier?: string;
}

