# 修复 DATABASE_URL 格式错误

## 🔍 问题分析

错误信息：
```
PrismaClientInitializationError: The provided database string is invalid.
The provided arguments are not supported in database URL.
```

**原因**：密码中的特殊字符 `!` 需要 URL 编码。

---

## 🛠️ 修复步骤

### 步骤 1：URL 编码密码中的特殊字符

密码 `Caigou_2025_Strong!` 中的 `!` 需要编码为 `%21`

**修改前**：
```bash
DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou?connection_limit=50&pool_timeout=20"
```

**修改后**：
```bash
DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"
```

---

### 步骤 2：在服务器上执行修复

```bash
# 1. 进入项目目录
cd /root/caigou/caigou/apps/api

# 2. 备份配置文件
cp .env .env.backup

# 3. 修复 DATABASE_URL（URL 编码密码中的 !）
# 方法 1：使用 sed 替换
sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou|g' .env

# 4. 如果还没有连接池参数，添加它们
if ! grep -q 'connection_limit=' .env; then
    sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"|g' .env
fi

# 5. 验证修改
grep DATABASE_URL .env

# 6. 重新构建
cd /root/caigou/caigou
npm run build

# 7. 重启服务
pm2 restart caigou-api

# 8. 查看日志确认
pm2 logs caigou-api --lines 30
```

---

### 步骤 3：或者手动编辑（推荐）

```bash
# 编辑文件
cd /root/caigou/caigou/apps/api
nano .env
```

找到 `DATABASE_URL` 这一行，修改为：

```bash
DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"
```

**关键点**：
- `!` 编码为 `%21`
- 使用引号包裹整个 URL
- 连接池参数在 URL 查询字符串中

保存并退出：
- 按 `Ctrl + O` 保存
- 按 `Enter` 确认
- 按 `Ctrl + X` 退出

---

## 📝 URL 编码参考

MySQL 连接字符串中需要编码的特殊字符：

| 字符 | URL 编码 |
|------|----------|
| `!` | `%21` |
| `@` | `%40` |
| `#` | `%23` |
| `$` | `%24` |
| `%` | `%25` |
| `&` | `%26` |
| `+` | `%2B` |
| `=` | `%3D` |
| `?` | `%3F` |
| ` ` (空格) | `%20` |

---

## ✅ 正确的 DATABASE_URL 格式

```bash
# 基本格式（无连接池）
DATABASE_URL="mysql://username:password@host:port/database"

# 带连接池参数
DATABASE_URL="mysql://username:password@host:port/database?connection_limit=50&pool_timeout=20"

# 如果密码包含特殊字符，需要 URL 编码
# 例如：密码是 "Pass!word@123"
# 编码后：Pass%21word%40123
DATABASE_URL="mysql://user:Pass%21word%40123@localhost:3306/db"
```

---

## 🔧 一键修复脚本

```bash
#!/bin/bash
set -e

echo "=== 修复 DATABASE_URL 格式 ==="
echo ""

cd /root/caigou/caigou/apps/api

# 备份
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
echo "✅ 配置文件已备份"

# 修复：URL 编码密码中的 ! 并添加连接池参数
if grep -q 'Caigou_2025_Strong!' .env; then
    echo "📝 修复 DATABASE_URL（URL 编码密码中的 !）..."
    sed -i 's|Caigou_2025_Strong!|Caigou_2025_Strong%21|g' .env
    echo "✅ 密码已 URL 编码"
fi

# 添加连接池参数（如果还没有）
if ! grep -q 'connection_limit=' .env; then
    echo "📝 添加连接池参数..."
    sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"|g' .env
    echo "✅ 连接池参数已添加"
fi

# 验证
echo ""
echo "修改后的配置："
grep DATABASE_URL .env

# 重新构建
echo ""
echo "重新构建项目..."
cd /root/caigou/caigou
npm run build
echo "✅ 构建完成"

# 重启服务
echo ""
echo "重启服务..."
pm2 restart caigou-api
sleep 3

# 验证
echo ""
echo "验证服务状态..."
HEALTH=$(curl -s http://localhost:8081/api/health 2>/dev/null | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || echo "error")
if [ "$HEALTH" = "ok" ]; then
    echo "✅ 服务启动成功！"
else
    echo "⚠️  服务可能还有问题，请查看日志: pm2 logs caigou-api"
fi

echo ""
echo "=== 修复完成 ==="
```

保存为 `fix-database-url.sh`，然后执行：
```bash
chmod +x fix-database-url.sh
./fix-database-url.sh
```

---

## 🚨 如果修复后仍然失败

### 检查 1：验证 URL 格式

```bash
# 查看当前配置
cd /root/caigou/caigou/apps/api
grep DATABASE_URL .env

# 应该看到：
# DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"
```

### 检查 2：测试数据库连接

```bash
# 使用编码后的密码测试连接
mysql -u caigou_user -p'Caigou_2025_Strong!' -h localhost -e "SELECT 1;"
```

### 检查 3：查看详细错误

```bash
# 查看完整错误日志
pm2 logs caigou-api --err --lines 50
```

---

## 📋 最终正确的配置

```bash
DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou?connection_limit=50&pool_timeout=20"
```

**关键点**：
- ✅ 密码中的 `!` 编码为 `%21`
- ✅ 使用引号包裹整个 URL
- ✅ 连接池参数在 URL 查询字符串中
- ✅ 参数之间用 `&` 连接

---

**最后更新**: 2025-12-07

