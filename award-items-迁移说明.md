# AwardItems 迁移说明

## 概述

引入了 `award_items` 关联表，明确记录每个 Award 包含的商品，解决了之前通过 `award -> quote -> quote_items` 推断导致的问题。

## 数据库变更

### 1. 创建 award_items 表

执行迁移脚本：
```bash
mysql -u root -p caigou < migrations/add-award-items-table.sql
```

### 2. 迁移现有数据

从现有 Award 记录生成 AwardItem 记录：
```bash
mysql -u root -p caigou < migrations/migrate-existing-awards-to-award-items.sql
```

## 代码变更

### 已更新的文件

1. **apps/api/prisma/schema.prisma**
   - 添加 `AwardItem` 模型
   - 在 `Award` 模型中添加 `items` 关系
   - 在 `RfqItem` 和 `QuoteItem` 模型中添加反向关系

2. **apps/api/src/queues/auction.queue.ts**
   - 创建 Award 时同时创建 AwardItem 记录
   - 更新 Award 时同步更新 AwardItem 记录

3. **apps/api/src/modules/rfq/rfq.service.ts**
   - 手动选商时创建 AwardItem 记录
   - 更新 Award 时同步更新 AwardItem 记录

4. **apps/api/src/modules/quote/quote.service.ts**
   - 一口价自动中标时创建 AwardItem 记录
   - 更新 Award 时检查并创建 AwardItem 记录

5. **apps/api/src/modules/award/award.service.ts**
   - 上传快递单号时创建 AwardItem 记录

## 待完成的工作

### 1. 更新查询逻辑

需要更新所有查询 Award 的代码，使用 `award.items` 而不是通过 `award.quote.items` 推断：

- [ ] `apps/api/src/modules/award/award.service.ts` - `findBySupplier`
- [ ] `apps/api/src/modules/award/award.service.ts` - `findByBuyer`
- [ ] `apps/api/src/modules/report/report.service.ts` - `getFinancialReport`
- [ ] `apps/api/src/modules/rfq/rfq.service.ts` - `getShipmentOverview`
- [ ] 其他查询 Award 的地方

### 2. 修复 TypeScript 类型错误

由于 Prisma Client 需要重新生成，可能需要：
- 重启 TypeScript 服务器
- 或者等待 IDE 重新加载类型定义

### 3. 测试

- [ ] 测试自动评标逻辑
- [ ] 测试手动选商逻辑
- [ ] 测试一口价自动中标逻辑
- [ ] 测试上传快递单号逻辑
- [ ] 测试查询逻辑（findBySupplier, findByBuyer, getFinancialReport）

## 使用方式

### 查询 Award 包含的商品

**之前（不推荐）**：
```typescript
const award = await prisma.award.findUnique({
  where: { id },
  include: {
    quote: {
      include: {
        items: true, // 包含所有商品，需要推断哪些真正中标
      },
    },
  },
});
```

**现在（推荐）**：
```typescript
const award = await prisma.award.findUnique({
  where: { id },
  include: {
    items: {
      include: {
        rfqItem: true,
        quoteItem: true,
      },
    },
  },
});
// award.items 明确记录了 Award 包含的商品
```

### 创建 Award 和 AwardItem

```typescript
const award = await prisma.award.create({
  data: {
    rfqId,
    quoteId,
    supplierId,
    finalPrice,
    reason,
    items: {
      create: [
        {
          rfqItemId: '...',
          quoteItemId: '...',
          price: 100,
          quantity: 1,
        },
        // ... 更多商品
      ],
    },
  },
});
```

## 优势

1. **明确性**：直接记录 Award 包含的商品，不需要推断
2. **准确性**：避免通过 `quote.items` 推断导致的错误
3. **性能**：查询时可以直接使用 `award.items`，不需要复杂的匹配逻辑
4. **可维护性**：代码更清晰，更容易理解和维护

## 注意事项

1. 迁移现有数据时，需要确保数据一致性
2. 创建 Award 时，必须同时创建对应的 AwardItem 记录
3. 更新 Award 时，需要同步更新 AwardItem 记录
4. 删除 Award 时，AwardItem 会自动删除（CASCADE）

