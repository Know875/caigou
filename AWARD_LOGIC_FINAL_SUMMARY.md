# 选商逻辑修复最终总结

## ✅ 已修复的问题

### 1. 一口价逻辑（instantPrice）

**问题**：一口价逻辑按价格排序，而不是按提交时间排序。

**修复**：
- ✅ `processEvaluate`（自动评标）- 优先选择满足一口价的报价，按提交时间排序（最早提交的优先）
- ✅ `checkInstantPriceAward`（一口价自动中标）- 检查是否已经有其他供应商先提交了满足一口价的报价
- ✅ `findByBuyer`（采购员查看）- 优先选择满足一口价的报价，即使 Award 记录指向不满足一口价的报价

### 2. 数据一致性

**问题**：重新选商后，之前包含该商品的 quote 的 status 和 price 没有正确更新。

**修复**：
- ✅ `awardItem`（手动选商）- 清理之前包含该商品的 AWARDED quote，重新计算 status 和 price
- ✅ `processEvaluate`（自动评标）- 更新 quote.price，只包含真正中标的商品
- ✅ `checkInstantPriceAward`（一口价自动中标）- 更新 quote.price，只包含真正中标的商品
- ✅ `uploadTrackingNumber`（上传物流单号）- 创建 Award 后更新 quote.status 和 quote.price
- ✅ `uploadShipmentPhotos`（上传发货照片）- 创建 Award 后更新 quote.status 和 quote.price
- ✅ `uploadPaymentQrCode`（上传收款二维码）- 创建 Award 后更新 quote.status 和 quote.price

### 3. Award 记录的 finalPrice

**问题**：Award 记录的 finalPrice 计算错误，没有包含所有真正中标的商品。

**修复**：
- ✅ `processEvaluate`（自动评标）- 重新计算 finalPrice，包含该供应商在该 RFQ 中所有真正中标的商品
- ✅ `awardItem`（手动选商）- 更新 finalPrice，包含该供应商在该 RFQ 中所有真正中标的商品

### 4. 前端显示逻辑

**问题**：前端仅依赖 `quote.status` 判断中标供应商，如果有多个报价的 status 都是 'AWARDED'，可能显示错误的供应商。

**修复**：
- ✅ 前端优先通过 Award 记录确定真正中标的供应商
- ✅ 如果没有 Award 记录，回退到使用 `quote.status`（兼容旧数据）

## 🔒 新数据保护机制

### 1. 自动评标（processEvaluate）

- ✅ 优先选择满足一口价的报价（价格 <= instantPrice）
- ✅ 如果多个报价都满足一口价，选择最早提交的（按 submittedAt 排序）
- ✅ 如果没有满足一口价的报价，按询价单类型处理（FIXED_PRICE 使用 maxPrice，其他使用最低价）

### 2. 一口价自动中标（checkInstantPriceAward）

- ✅ 检查商品是否已经被其他供应商中标
- ✅ 检查是否已经有其他供应商先提交了满足一口价的报价
- ✅ 只有最早提交且满足一口价的供应商才会自动中标

### 3. 手动选商（awardItem）

- ✅ 清理之前包含该商品的 AWARDED quote
- ✅ 重新计算之前 quote 的 price（排除当前商品）
- ✅ 重新计算新中标 quote 的 price（只包含真正中标的商品）
- ✅ 更新 Award 记录的 finalPrice

### 4. 数据查询（findByBuyer）

- ✅ 优先通过 Award 记录确定中标供应商
- ✅ 如果有多个 Award 记录，优先选择满足一口价的报价
- ✅ 如果没有 Award 记录，也优先选择满足一口价的报价
- ✅ 如果多个报价都满足一口价，选择最早提交的

## 📋 修复的文件清单

### 后端代码
1. ✅ `apps/api/src/queues/auction.queue.ts` - `processEvaluate` 方法
2. ✅ `apps/api/src/modules/quote/quote.service.ts` - `checkInstantPriceAward` 和 `awardQuote` 方法
3. ✅ `apps/api/src/modules/rfq/rfq.service.ts` - `awardItem` 方法
4. ✅ `apps/api/src/modules/award/award.service.ts` - `findByBuyer`、`uploadTrackingNumber`、`uploadShipmentPhotos`、`uploadPaymentQrCode` 方法

### 前端代码
1. ✅ `apps/web/app/rfqs/[id]/page.tsx` - 中标供应商显示逻辑

## ✅ 确认：新数据不会再出现同样的问题

**原因**：

1. **一口价逻辑已修复**：
   - 所有相关方法都优先选择满足一口价的报价
   - 如果多个报价都满足一口价，选择最早提交的
   - 不满足一口价的报价不会被选中

2. **数据一致性已保证**：
   - 所有选商逻辑都会正确更新 quote.status 和 quote.price
   - Award 记录的 finalPrice 会正确计算
   - 重新选商时会正确清理之前的 AWARDED quote

3. **前端显示已修复**：
   - 优先通过 Award 记录确定中标供应商
   - 即使 Award 记录指向错误的供应商，也会优先选择满足一口价的报价

4. **多层保护**：
   - 自动评标时：优先选择满足一口价的报价
   - 一口价自动中标时：检查是否已经有其他供应商先提交
   - 手动选商时：清理之前的 AWARDED quote
   - 数据查询时：优先选择满足一口价的报价

## 🎯 结论

**新创建的 RFQ 不会再出现同样的问题**，因为：

1. ✅ 所有选商逻辑都优先选择满足一口价的报价
2. ✅ 如果多个报价都满足一口价，选择最早提交的
3. ✅ 数据一致性在所有场景下都得到保证
4. ✅ 前端显示逻辑已修复，即使 Award 记录错误，也会优先显示满足一口价的供应商

**只有旧的 RFQ（在修复之前关闭的）可能需要手动修复数据。**

