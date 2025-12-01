# 调试登录指南 - 如何登录其他账户进行调试

## 问题

密码是哈希存储的，无法查看原始密码。如果需要登录其他账户进行调试，需要**重置密码**。

## 解决方案

### 方法1：重置密码为已知密码（推荐）

使用重置密码脚本，将目标账户的密码重置为你知道的密码：

```bash
cd /root/caigou/caigou/apps/api

# 重置密码（将 user@example.com 的密码重置为 debug123）
node ../scripts/reset-password.js user@example.com debug123
```

然后使用新密码登录：
- 邮箱：`user@example.com`
- 密码：`debug123`

### 方法2：通过数据库直接重置

```bash
# 1. 生成新密码的哈希值
cd /root/caigou/caigou/apps/api
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('debug123', 10).then(hash => console.log(hash));"

# 2. 复制输出的哈希值，然后更新数据库
mysql -u root -p caigou
UPDATE users SET password = '生成的哈希值' WHERE email = 'user@example.com';
```

### 方法3：创建临时调试账户（推荐用于测试）

如果需要频繁调试，可以创建一个专门的调试账户：

```bash
# 通过 API 注册一个调试账户
curl -X POST http://localhost:8081/api/auth/register-supplier \
  -H "Content-Type: application/json" \
  -d '{
    "email": "debug@test.com",
    "username": "调试账户",
    "password": "debug123",
    "companyName": "调试公司"
  }'
```

或者通过数据库直接创建：

```bash
cd /root/caigou/caigou/apps/api

# 生成密码哈希
HASH=$(node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('debug123', 10).then(hash => console.log(hash));")

# 插入用户（需要根据实际数据库调整）
mysql -u root -p caigou << EOF
INSERT INTO users (id, email, username, password, role, status, created_at, updated_at)
VALUES (
  'debug-user-id',
  'debug@test.com',
  '调试账户',
  '$HASH',
  'ADMIN',
  'ACTIVE',
  NOW(),
  NOW()
);
EOF
```

## 快速重置脚本

我已经创建了重置密码脚本，使用非常简单：

```bash
cd /root/caigou/caigou/apps/api

# 重置指定账户的密码
node ../scripts/reset-password.js 目标邮箱 新密码

# 示例：将 admin@example.com 的密码重置为 admin123
node ../scripts/reset-password.js admin@example.com admin123
```

## 调试完成后

调试完成后，建议：
1. **恢复原密码**（如果知道的话）
2. **或通知用户重置密码**
3. **或删除临时调试账户**

## 查看所有账户

在重置前，可以先查看所有账户：

```bash
mysql -u root -p caigou -e "SELECT email, username, role, status FROM users ORDER BY role, email;"
```

## 安全建议

1. **使用临时密码**：调试时使用简单的临时密码（如 `debug123`）
2. **调试后恢复**：调试完成后通知用户修改密码
3. **记录操作**：记录哪些账户被重置过密码
4. **限制权限**：只在必要时重置密码

## 示例：完整的调试流程

```bash
# 1. 查看目标账户
mysql -u root -p caigou -e "SELECT email, username, role FROM users WHERE email = 'target@example.com';"

# 2. 重置密码
cd /root/caigou/caigou/apps/api
node ../scripts/reset-password.js target@example.com debug123

# 3. 使用新密码登录
# 邮箱: target@example.com
# 密码: debug123

# 4. 调试完成后，通知用户修改密码或再次重置为安全密码
```

