import {
  Controller,
  Post,
  Body,
  UseGuards,
  Get,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterStoreDto } from './dto/register-store.dto';
import { RegisterSupplierDto } from './dto/register-supplier.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('认证')
@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: '登录' })
  async login(@Body() loginDto: LoginDto) {
    // console.log('[AuthController] 收到登录请求:', {
    //   email: loginDto?.email,
    //   hasPassword: !!loginDto?.password,
    //   passwordLength: loginDto?.password?.length,
    //   loginDto: JSON.stringify(loginDto),
    // });

    // 验证数据
    if (!loginDto?.email || !loginDto?.password) {
      console.error('[AuthController] 缺少必填字段:', {
        email: !!loginDto?.email,
        password: !!loginDto?.password,
      });
      throw new BadRequestException('邮箱和密码为必填项');
    }

    try {
      const result = await this.authService.login(loginDto);
      // console.log('[AuthController] 登录成功:', {
      //   email: loginDto.email,
      //   userId: result.user?.id,
      //   hasAccessToken: !!result.access_token,
      //   userRole: result.user?.role,
      // });
      // console.log('[AuthController] 返回数据:', JSON.stringify(result, null, 2));
      return result;
    } catch (error: any) {
      console.error('[AuthController] 登录失败:', {
        message: error.message,
        stack: error.stack,
        name: error.name,
        status: error.status,
        response: error.response,
      });
      throw error;
    }
  }

  @Get('health')
  @ApiOperation({ summary: '健康检查（无需认证）' })
  health() {
    // console.log('[AuthController] 健康检查请求');
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'auth',
    };
  }

  @Post('test')
  @ApiOperation({ summary: '测试 POST 请求（无需认证）' })
  test(@Body() body: any) {
    // console.log('[AuthController] 收到测试 POST 请求:', {
    //   body,
    //   timestamp: new Date().toISOString(),
    // });
    return {
      status: 'ok',
      message: 'POST 请求成功',
      receivedData: body,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('register-store')
  @ApiOperation({ summary: '门店注册' })
  async registerStore(@Body() registerStoreDto: RegisterStoreDto) {
    // console.log('[AuthController] 收到门店注册请求:', {
    //   email: registerStoreDto?.email,
    //   storeName: registerStoreDto?.storeName,
    //   storeCode: registerStoreDto?.storeCode,
    // });

    try {
      const result = await this.authService.registerStore(registerStoreDto);

      // console.log('[AuthController] 门店注册成功，等待审批:', {
      //   userId: result.user.id,
      //   storeId: result.store.id,
      //   status: result.user.status,
      // });

      // 注册成功但不自动登录，需要等待管理员审核
      return {
        message:
          '注册成功，您的账号正在审核中，审核通过后即可登录使用。如有疑问，请联系管理员：17267287629',
        user: result.user,
        store: result.store,
        requiresApproval: true,
      };
    } catch (error: any) {
      console.error('[AuthController] 门店注册失败:', {
        message: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  @Post('register-supplier')
  @ApiOperation({ summary: '供应商注册' })
  async registerSupplier(@Body() registerSupplierDto: RegisterSupplierDto) {
    // console.log('[AuthController] 收到供应商注册请求:', {
    //   email: registerSupplierDto?.email,
    //   username: registerSupplierDto?.username,
    //   companyName: registerSupplierDto?.companyName,
    // });

    try {
      const result = await this.authService.registerSupplier(registerSupplierDto);

      // console.log('[AuthController] 供应商注册成功，等待审核:', {
      //   userId: result.user.id,
      //   status: result.user.status,
      // });

      // 注册成功但不自动登录，需要等待审核
      return {
        message:
          '注册成功，您的账号正在审核中，审核通过后即可登录使用。如有疑问，请联系管理员：17267287629',
        user: result.user,
        requiresApproval: true,
      };
    } catch (error: any) {
      console.error('[AuthController] 供应商注册失败:', {
        message: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息' })
  getProfile(@Request() req) {
    return req.user;
  }
}
