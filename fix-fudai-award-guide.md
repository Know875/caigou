# 修复福袋商品错误中标问题 - 操作指南

## 问题描述
RFQ-1764574989800 中，福袋商品的一口价是¥86.00，"可乐"和"赛罗"的报价都是¥86.00（满足一口价条件），应该自动中标。但是系统错误地选择了"豪"（¥89.00）中标。

## 修复步骤

### 1. 连接到数据库
```bash
mysql -u your_username -p your_database_name
```

### 2. 执行查询语句获取实际数据

#### 2.1 查找询价单ID
```sql
SELECT id, rfqNo, status, buyerId 
FROM rfqs 
WHERE rfqNo = 'RFQ-1764574989800';
```
**记录结果**：`id` = `@RFQ_ID`

#### 2.2 查找福袋商品的rfqItemId
```sql
SELECT id, productName, instantPrice, maxPrice, itemStatus, quantity
FROM rfq_items 
WHERE rfqId = '@RFQ_ID' AND productName LIKE '%模玩兽100元福袋%'
ORDER BY createdAt;
```
**记录结果**：所有福袋商品的 `id` 列表

#### 2.3 查找所有供应商的报价
```sql
SELECT q.id as quote_id, u.username, u.id as supplier_id, q.status as quote_status, q.createdAt
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
WHERE q.rfqId = '@RFQ_ID'
ORDER BY u.username;
```
**记录结果**：
- "可乐"的 `supplier_id` = `@SUPPLIER_ID_KELE`
- "可乐"的 `quote_id` = `@QUOTE_ID_KELE`
- "豪"的 `supplier_id` = `@SUPPLIER_ID_HAO`
- "豪"的 `quote_id` = `@QUOTE_ID_HAO`

#### 2.4 查找福袋商品的所有报价
```sql
SELECT 
  qi.id as quote_item_id,
  qi.quoteId,
  qi.rfqItemId,
  qi.price,
  q.supplierId,
  u.username as supplier_name,
  ri.productName,
  ri.instantPrice,
  ri.itemStatus
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE ri.rfqId = '@RFQ_ID' 
  AND ri.productName LIKE '%模玩兽100元福袋%'
ORDER BY qi.price ASC, u.username;
```
**确认**：
- "可乐"和"赛罗"的报价都是¥86.00
- "豪"的报价是¥89.00

#### 2.5 查找"豪"的Award记录
```sql
SELECT 
  a.id as award_id,
  a.rfqId,
  a.quoteId,
  a.supplierId,
  u.username as supplier_name,
  a.finalPrice,
  a.status,
  a.reason
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = '@RFQ_ID' AND u.username = '豪';
```
**记录结果**：`award_id` = `@AWARD_ID_HAO`（如果有）

#### 2.6 检查"豪"的Award记录包含哪些商品
```sql
SELECT 
  a.id as award_id,
  ri.productName,
  ri.itemStatus,
  qi.price,
  ri.quantity
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.id = '@AWARD_ID_HAO'
ORDER BY ri.productName;
```
**确认**："豪"的Award记录是否还包含其他商品（如SHF巧爷）

### 3. 执行修复SQL

打开 `fix-fudai-award-practical.sql` 文件，将所有变量替换为实际值：

- `@RFQ_ID` → 从步骤2.1得到的id
- `@SUPPLIER_ID_KELE` → 从步骤2.3得到的"可乐"的supplier_id
- `@QUOTE_ID_KELE` → 从步骤2.3得到的"可乐"的quote_id
- `@SUPPLIER_ID_HAO` → 从步骤2.3得到的"豪"的supplier_id
- `@AWARD_ID_HAO` → 从步骤2.5得到的award_id（如果有）

**重要**：
1. 根据步骤2.6的结果，决定是否需要删除"豪"的Award记录
2. 如果"豪"的Award记录还包含其他商品（如SHF巧爷），只更新finalPrice，不删除
3. 如果"豪"的Award记录只包含福袋商品，可以删除该Award记录

### 4. 验证修复结果

执行验证SQL（在 `fix-fudai-award-practical.sql` 文件的第三步中）：

1. **验证福袋商品的中标状态**：应该显示"可乐"中标，价格¥86.00
2. **验证"可乐"的报价状态**：应该显示 `status = 'AWARDED'`
3. **验证"豪"的报价状态**：如果"豪"还有其他商品中标，状态应该是 `AWARDED`；如果没有，状态应该是 `REJECTED`
4. **验证Award记录**：应该显示"可乐"有Award记录，"豪"的Award记录（如果有）应该只包含其他商品

## 注意事项

1. **备份数据**：在执行修复SQL之前，建议先备份数据库
2. **事务处理**：所有修复SQL都在事务中执行，如果发现问题可以回滚
3. **逐步执行**：建议先执行查询语句确认数据，再执行更新语句
4. **验证结果**：修复后务必执行验证SQL确认结果正确

## 如果遇到问题

如果执行过程中遇到问题，可以：
1. 回滚事务：`ROLLBACK;`
2. 检查错误信息
3. 重新执行查询语句确认数据
4. 联系技术支持

