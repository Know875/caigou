# 🚀 部署检查清单

## ⚠️ 重要：部署后必须执行的步骤

### 1. 生成 Prisma Client（必需）

**问题**：如果服务器上的 Prisma Client 没有重新生成，新的数据库关系（如 `RfqItem.order`）将无法使用。

```bash
cd /path/to/your/project
npm run db:generate
```

**验证**：
```bash
# 检查 Prisma Client 是否包含新的关系
ls -la apps/api/node_modules/.prisma/client/
```

### 2. 运行数据库迁移（如果需要）

如果 schema 有变化，需要运行迁移：

```bash
npm run db:migrate
```

**注意**：`RfqItem.order` 关系是通过 `orderNo` 字段关联的，如果该字段和索引已存在，可能不需要迁移。

### 3. 重新构建项目（必需）

```bash
npm run build
```

### 4. 重启应用（必需）

**使用 PM2**：
```bash
pm2 restart all
# 或
pm2 restart ecosystem.config.js
```

**手动启动**：
```bash
# 停止旧进程
pkill -f "node.*main.js"

# 启动新进程
cd apps/api
node dist/main.js
```

### 5. 验证部署

#### 5.1 检查应用日志

```bash
# PM2 日志
pm2 logs

# 或查看日志文件
tail -f logs/api-out.log
tail -f logs/api-error.log
```

#### 5.2 检查 API 响应

```bash
# 测试发货总览接口
curl http://localhost:8081/api/rfqs/shipment-overview | jq '.[0] | {recipient, phone, address}'
```

#### 5.3 检查数据库关系

```bash
# 连接到数据库
mysql -u your_user -p your_database

# 检查 RfqItem 表是否有 orderNo 字段和索引
SHOW COLUMNS FROM rfq_items LIKE 'orderNo';
SHOW INDEX FROM rfq_items WHERE Key_name LIKE '%orderNo%';
```

## 🔍 常见问题排查

### 问题 1：地址和电话不显示

**症状**：本地可以显示，但服务器上不显示

**可能原因**：
1. Prisma Client 未重新生成
2. 应用未重启
3. 数据库关系未正确建立

**解决方案**：
```bash
# 1. 重新生成 Prisma Client
npm run db:generate

# 2. 重新构建
npm run build

# 3. 重启应用
pm2 restart all

# 4. 检查日志
pm2 logs --lines 50
```

### 问题 2：TypeError: Cannot read properties of undefined

**症状**：服务器日志中出现 `item.order is undefined`

**可能原因**：
- Prisma Client 未包含新的关系定义

**解决方案**：
```bash
# 强制重新生成 Prisma Client
rm -rf apps/api/node_modules/.prisma
npm run db:generate
npm run build
pm2 restart all
```

### 问题 3：数据库关系查询返回空

**症状**：`item.order` 总是 `null`

**可能原因**：
1. `RfqItem.orderNo` 字段值为空
2. `Order.orderNo` 不匹配
3. 数据库外键约束未建立

**检查方法**：
```sql
-- 检查 RfqItem 的 orderNo
SELECT id, productName, orderNo FROM rfq_items LIMIT 10;

-- 检查 Order 的 orderNo
SELECT id, orderNo, recipient, phone, address FROM orders LIMIT 10;

-- 检查是否有匹配的记录
SELECT 
  ri.id as rfq_item_id,
  ri.productName,
  ri.orderNo,
  o.id as order_id,
  o.recipient,
  o.phone,
  o.address
FROM rfq_items ri
LEFT JOIN orders o ON ri.orderNo = o.orderNo
WHERE ri.orderNo IS NOT NULL
LIMIT 10;
```

## 📋 完整部署流程

```bash
# 1. 进入项目目录
cd /var/www/egg-purchase

# 2. 拉取最新代码（如果使用 Git）
git pull origin main

# 3. 安装依赖（如果有新依赖）
npm install

# 4. 生成 Prisma Client（必需）
npm run db:generate

# 5. 运行数据库迁移（如果需要）
npm run db:migrate

# 6. 构建项目
npm run build

# 7. 重启应用
pm2 restart all

# 8. 检查状态
pm2 status
pm2 logs --lines 20
```

## 🎯 快速修复脚本

如果遇到地址电话不显示的问题，运行以下命令：

```bash
#!/bin/bash
# 快速修复脚本

echo "🔧 开始修复..."

# 1. 重新生成 Prisma Client
echo "📦 重新生成 Prisma Client..."
npm run db:generate

# 2. 重新构建
echo "🔨 重新构建项目..."
npm run build

# 3. 重启应用
echo "🔄 重启应用..."
pm2 restart all

# 4. 等待服务启动
sleep 5

# 5. 检查状态
echo "📊 检查服务状态..."
pm2 status

echo "✅ 修复完成！请检查日志：pm2 logs"
```

保存为 `fix-deployment.sh`，然后运行：
```bash
chmod +x fix-deployment.sh
./fix-deployment.sh
```

## 📝 部署后验证清单

- [ ] Prisma Client 已重新生成
- [ ] 项目已重新构建
- [ ] 应用已重启
- [ ] 日志中没有错误
- [ ] API 接口返回正确的数据
- [ ] 前端页面显示地址和电话

## 🔗 相关文档

- [DEPLOYMENT.md](./DEPLOYMENT.md) - 完整部署指南
- [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) - 数据库迁移指南

