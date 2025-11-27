import { IsEmail, IsString, MinLength, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterSupplierDto {
  @ApiProperty({ example: 'XX@XX.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: '供应商名称' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional({ example: 'XX供应商有限公司' })
  @IsOptional()
  @IsString()
  companyName?: string;

  @ApiPropertyOptional({ example: '手机号' })
  @IsOptional()
  @IsString()
  contact?: string;

  @ApiPropertyOptional({ example: '公司地址' })
  @IsOptional()
  @IsString()
  address?: string;
}

