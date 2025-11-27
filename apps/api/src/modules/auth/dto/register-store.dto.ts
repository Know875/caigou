import { IsEmail, IsString, MinLength, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterStoreDto {
  @ApiProperty({ example: 'store@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: '门店管理员' })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: 'password123' })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: 'XX门店' })
  @IsString()
  @IsNotEmpty()
  storeName: string;

  @ApiProperty({ example: 'STORE001' })
  @IsString()
  @IsNotEmpty()
  storeCode: string;

  @ApiProperty({ example: 'XX市XX区XX路XX号', required: false })
  @IsString()
  @IsOptional()
  address?: string;

  @ApiProperty({ example: '13800138000', required: false })
  @IsString()
  @IsOptional()
  contact?: string;
}

