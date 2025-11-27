import { Controller, Get, UseGuards, Param, Request, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { UserService } from './user.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('用户')
@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
@Roles('ADMIN', 'BUYER') // 管理员和采购员可以查看用户列表
export class UserController {
  constructor(private userService: UserService) {}

  @Get()
  @ApiOperation({ summary: '获取用户列表' })
  findAll(@Request() req) {
    // 双重检查：确保只有管理员和采购员可以访问
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new ForbiddenException('仅管理员和采购员可访问');
    }
    return this.userService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: '获取用户详情' })
  findOne(@Param('id') id: string, @Request() req) {
    // 双重检查：确保只有管理员和采购员可以访问
    if (req.user.role !== 'ADMIN' && req.user.role !== 'BUYER') {
      throw new ForbiddenException('仅管理员和采购员可访问');
    }
    return this.userService.findOne(id);
  }
}

