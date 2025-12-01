# 查看和重置用户密码

## 重要说明

⚠️ **密码是哈希存储的，无法查看原始密码**

系统使用 `bcrypt` 对密码进行哈希存储，这是**单向加密**，无法反向解密获取原始密码。

## 查看用户信息（包括密码哈希值）

### 方法1：通过数据库直接查询

```bash
# 连接数据库
mysql -u root -p caigou

# 查看所有用户（包括密码哈希值）
SELECT id, email, username, password, role, status FROM users;

# 查看特定用户（通过邮箱）
SELECT id, email, username, password, role, status FROM users WHERE email = 'user@example.com';

# 查看特定用户（通过用户名）
SELECT id, email, username, password, role, status FROM users WHERE username = '用户名';
```

### 方法2：通过 Prisma Studio（图形界面）

```bash
cd /root/caigou/caigou/apps/api
npx prisma studio
```

然后在浏览器中打开 `http://localhost:5555`，查看 `User` 表。

## 重置用户密码

由于无法查看原始密码，如果需要让用户登录，需要**重置密码**。

### 方法1：使用 SQL 重置密码（需要生成新的哈希值）

```bash
# 1. 生成新密码的哈希值（使用 Node.js）
node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('新密码', 10).then(hash => console.log(hash));"

# 2. 使用生成的哈希值更新数据库
mysql -u root -p caigou
UPDATE users SET password = '生成的哈希值' WHERE email = 'user@example.com';
```

### 方法2：创建重置密码脚本

创建一个临时脚本 `reset-password.js`：

```javascript
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function resetPassword(email, newPassword) {
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const user = await prisma.user.update({
    where: { email },
    data: { password: hashedPassword },
  });
  console.log(`密码已重置: ${email}`);
  return user;
}

// 使用示例
resetPassword('user@example.com', '新密码123')
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
```

然后运行：
```bash
cd /root/caigou/caigou/apps/api
node reset-password.js
```

### 方法3：通过 API 重置（如果有重置密码接口）

检查是否有重置密码的 API 接口：
```bash
# 查看 API 文档
curl http://localhost:8081/api/docs
```

## 查看密码哈希值的格式

bcrypt 哈希值通常以 `$2a$` 或 `$2b$` 开头，例如：
```
$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy
```

## 安全建议

1. **不要分享密码哈希值**：虽然无法反向解密，但哈希值仍然敏感
2. **定期重置密码**：如果怀疑密码泄露，立即重置
3. **使用强密码**：重置时使用强密码策略
4. **记录操作**：重置密码时记录操作日志

## 快速查询示例

```bash
# 查看所有管理员账户
mysql -u root -p caigou -e "SELECT email, username, role FROM users WHERE role = 'ADMIN';"

# 查看所有供应商账户
mysql -u root -p caigou -e "SELECT email, username, role FROM users WHERE role = 'SUPPLIER';"

# 查看特定邮箱的用户信息
mysql -u root -p caigou -e "SELECT email, username, role, status FROM users WHERE email = 'user@example.com';"
```

