#!/usr/bin/env node

/**
 * 重置用户密码脚本
 * 使用方法: node scripts/reset-password.js <email> <newPassword>
 */

const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetPassword(email, newPassword) {
  if (!email || !newPassword) {
    console.error('❌ 用法: node reset-password.js <email> <newPassword>');
    console.error('示例: node reset-password.js user@example.com newpass123');
    process.exit(1);
  }

  try {
    // 检查用户是否存在
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, username: true, role: true },
    });

    if (!user) {
      console.error(`❌ 用户不存在: ${email}`);
      process.exit(1);
    }

    console.log(`📋 找到用户: ${user.username} (${user.email})`);
    console.log(`📋 角色: ${user.role}`);

    // 生成新密码哈希
    console.log('🔐 正在生成密码哈希...');
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // 更新密码
    await prisma.user.update({
      where: { email },
      data: { password: hashedPassword },
    });

    console.log(`✅ 密码已重置成功！`);
    console.log(`📧 邮箱: ${email}`);
    console.log(`👤 用户名: ${user.username}`);
    console.log(`🔑 新密码: ${newPassword}`);
    console.log('');
    console.log('⚠️  请妥善保管新密码，并告知用户及时修改！');

  } catch (error) {
    console.error('❌ 重置密码失败:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// 从命令行参数获取邮箱和新密码
const email = process.argv[2];
const newPassword = process.argv[3];

resetPassword(email, newPassword);

