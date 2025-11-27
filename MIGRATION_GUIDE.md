# 数据库迁移指南 - 添加 RfqItem 和 Order 的 relation

## 问题
当前 `rfq_items` 表有 `orderNo` 字段，但没有通过 Prisma relation 直接关联到 `orders` 表，导致查询订单信息时需要复杂的 JOIN 逻辑。

## 解决方案
在 Prisma schema 中添加 `RfqItem` 和 `Order` 之间的 relation，通过 `orderNo` 字段关联。

## 迁移步骤

### 1. 生成 Prisma Client（必须）
```bash
cd apps/api
npx prisma generate
```

### 2. 创建数据库迁移（可选，因为只是添加 relation，不改变数据库结构）
```bash
cd apps/api
npx prisma migrate dev --name add_rfqitem_order_relation
```

或者如果只是添加 relation（不改变数据库结构），可以直接：
```bash
npx prisma db push
```

### 3. 验证
迁移后，TypeScript 类型错误应该消失，代码可以正常使用 `item.order` 来访问订单信息。

## 注意事项
- 这个迁移不会改变数据库结构，只是添加了 Prisma 的 relation 定义
- `orderNo` 字段在 `orders` 表中已经有 `@unique` 约束，所以可以用于 relation
- 如果 `rfq_items.orderNo` 为 NULL，`item.order` 也会是 NULL（这是正常的）

