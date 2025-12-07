# 快速修复 DATABASE_URL - 简化版

## 🚨 问题

Prisma 报错：`The provided database string is invalid`

**原因**：
1. 密码中的 `!` 需要 URL 编码为 `%21`
2. Prisma 6.x 可能不支持在 URL 中直接使用连接池参数

---

## ✅ 快速修复（两步走）

### 第一步：先修复 URL 编码，让服务启动

```bash
# 1. 进入项目目录
cd /root/caigou/caigou/apps/api

# 2. 备份
cp .env .env.backup

# 3. 修复：只修复 URL 编码，暂时去掉连接池参数
sed -i 's|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou.*"|DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"|g' .env

# 4. 验证
grep DATABASE_URL .env

# 应该看到：
# DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"

# 5. 重新构建并重启
cd /root/caigou/caigou
npm run build
pm2 restart caigou-api

# 6. 查看日志
pm2 logs caigou-api --lines 30
```

---

### 第二步：通过代码配置连接池（服务启动后）

服务启动成功后，我们再通过修改代码来配置连接池。

---

## 🔧 手动修复（如果 sed 不工作）

```bash
# 1. 编辑文件
cd /root/caigou/caigou/apps/api
nano .env
```

找到 `DATABASE_URL` 这一行，修改为：

```bash
DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"
```

**关键点**：
- ✅ `!` 编码为 `%21`
- ✅ 暂时**不要**添加连接池参数（先让服务启动）
- ✅ 使用引号包裹整个 URL

保存并退出：
- 按 `Ctrl + O` 保存
- 按 `Enter` 确认
- 按 `Ctrl + X` 退出

然后：
```bash
cd /root/caigou/caigou
npm run build
pm2 restart caigou-api
pm2 logs caigou-api --lines 30
```

---

## ✅ 验证修复

修复后，检查服务是否正常：

```bash
# 1. 检查服务状态
pm2 status

# 2. 查看日志（应该没有错误）
pm2 logs caigou-api --lines 20

# 3. 测试健康检查
curl http://localhost:8081/api/health

# 应该返回：{"status":"ok",...}
```

---

## 📝 修复前后对比

**修复前（错误）**：
```bash
DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong!@localhost:3306/caigou?connection_limit=50&pool_timeout=20"
```

**修复后（正确）**：
```bash
DATABASE_URL="mysql://caigou_user:Caigou_2025_Strong%21@localhost:3306/caigou"
```

---

## 🚀 服务启动后，再配置连接池

服务启动成功后，我们可以通过修改 `prisma.service.ts` 来配置连接池，而不是在 URL 中。

但现在先让服务启动起来最重要！

---

**最后更新**: 2025-12-07

