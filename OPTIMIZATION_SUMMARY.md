# 订单信息查询优化总结

## 问题根源
- ✅ 数据库里订单的地址/电话数据是有的
- ✅ `rfq_items.orderNo` 和 `orders.orderNo` 可以正确关联
- ❌ 后端查询时没有直接通过 `orderNo` JOIN `orders` 表，导致无法获取订单信息

## 优化方案

### 1. Prisma Schema 优化 ✅
在 `apps/api/prisma/schema.prisma` 中添加了 `RfqItem` 和 `Order` 之间的 relation：

```prisma
model Order {
  // ...
  rfqItems  RfqItem[] @relation("OrderByOrderNo") // 通过 orderNo 关联的 RfqItem
}

model RfqItem {
  // ...
  orderNo   String?
  order     Order?   @relation("OrderByOrderNo", fields: [orderNo], references: [orderNo])
}
```

**优势**：
- 直接通过 `orderNo` 关联，不需要通过 `order_rfqs` 中间表
- 一对一关系，查询结果干净，不会有重复
- Prisma 自动处理 JOIN，代码更简洁

### 2. 查询逻辑优化 ✅

#### 2.1 电商采购清单 (`findUnquotedItems`)
**之前**：通过 `rfq.orders` 中间表匹配，逻辑复杂
**现在**：直接使用 `item.order` 获取订单信息

```typescript
// 优化前：复杂的匹配逻辑
const orderInfos = rfq.orders.map(...);
let matchedOrder = orderInfos.find(...);

// 优化后：直接使用
const order = item.order;
```

#### 2.2 供应商查看中标订单 (`findBySupplier`)
**之前**：通过 `award.rfq.orders` 匹配订单
**现在**：直接使用 `rfqItem.order` 获取订单信息

```typescript
// 优化前：复杂的匹配逻辑
const matchedOrder = award.rfq.orders.find(...);

// 优化后：直接使用
const order = rfqItem.order;
```

### 3. 代码改进点

1. **简化匹配逻辑**：不再需要复杂的订单匹配算法
2. **提高性能**：直接 JOIN，避免多次查询
3. **数据准确性**：一对一关系，不会有重复数据
4. **代码可读性**：`item.order` 比 `matchedOrder` 更直观

## 部署步骤

### 1. 在服务器上生成 Prisma Client
```bash
cd /root/caigou/caigou/apps/api
npx prisma generate
```

### 2. 创建数据库迁移（可选）
```bash
npx prisma migrate dev --name add_rfqitem_order_relation
```

或者直接推送（不改变数据库结构）：
```bash
npx prisma db push
```

### 3. 重新构建和重启
```bash
cd /root/caigou/caigou
npm run build
pm2 restart caigou-api
pm2 restart caigou-web
```

## 验证

部署后，检查以下功能：

1. **电商采购清单页面**：
   - 有 `orderNo` 的商品应该显示地址和电话
   - 没有 `orderNo` 的商品显示 "-"（这是正常的）

2. **供应商发货管理页面**：
   - 中标后应该能看到订单的地址和电话信息

3. **询价单详情页面**：
   - 商品信息应该能正确显示关联的订单信息

## 注意事项

1. **`orderNo` 为 NULL 的情况**：
   - 如果 `rfq_items.orderNo` 为 NULL，`item.order` 也会是 NULL
   - 这是正常的业务逻辑（手工创建的询价单没有对应订单）

2. **类型错误**：
   - 本地可能有 TypeScript 类型错误，这是因为 Prisma Client 还没重新生成
   - 在服务器上运行 `prisma generate` 后会自动解决

3. **向后兼容**：
   - 保留了 `rfq.orders` 关系用于兼容
   - 但优先使用 `item.order`（更直接、更准确）

## 测试 SQL

可以在数据库中验证 relation 是否正确：

```sql
-- 检查 RfqItem 和 Order 的关联
SELECT 
  ri.id as rfqItemId,
  ri.orderNo,
  ri.productName,
  o.id as orderId,
  o.orderNo as orderOrderNo,
  o.recipient,
  o.phone,
  o.address
FROM rfq_items ri
LEFT JOIN orders o ON ri.orderNo = o.orderNo
WHERE ri.orderNo IS NOT NULL
LIMIT 10;
```

如果查询结果正确，说明数据库层面的关联是正确的。

