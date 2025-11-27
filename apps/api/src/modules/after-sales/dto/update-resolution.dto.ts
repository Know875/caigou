import { IsString, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateResolutionDto {
  @ApiProperty({ description: '处理方案', required: false })
  @IsOptional()
  @IsString()
  resolution?: string;

  @ApiProperty({ description: '进度描述', required: false })
  @IsOptional()
  @IsString()
  progressDescription?: string;
}

