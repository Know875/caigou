import { IsEmail, IsString, IsOptional, MinLength, IsEnum, IsArray, ValidateNested, ArrayMinSize, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSupplierDto {
  @ApiProperty({ description: '邮箱地址', example: 'XX@example.com' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @ApiProperty({ description: '用户名', example: '供应商名称' })
  @IsString({ message: '用户名必须是字符串' })
  username: string;

  @ApiProperty({ description: '密码', example: 'password123', minLength: 6 })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(6, { message: '密码长度至少为6位' })
  password: string;

  @ApiPropertyOptional({ description: '用户状态', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'], default: 'ACTIVE' })
  @IsOptional()
  @IsEnum(['ACTIVE', 'INACTIVE', 'SUSPENDED'], { message: '状态必须是 ACTIVE、INACTIVE 或 SUSPENDED' })
  status?: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}

export class CreateSuppliersDto {
  @ApiProperty({ description: '供应商列表', type: [CreateSupplierDto] })
  @IsArray({ message: '供应商列表必须是数组' })
  @ArrayMinSize(1, { message: '至少需要提供一个供应商' })
  @ArrayMaxSize(100, { message: '一次最多只能创建100个供应商' })
  @ValidateNested({ each: true })
  @Type(() => CreateSupplierDto)
  suppliers: CreateSupplierDto[];
}

