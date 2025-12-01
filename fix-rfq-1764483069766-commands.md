# 修复 RFQ-1764483069766 数据不一致问题 - 服务器操作指南

## 问题描述
- **按商品选商**显示：UR神光棒由赛罗中标（¥549.00）
- **中标订单物流信息**显示：豪的中标金额¥738.00，包含UR神光棒（¥550.00，豪的报价）

这说明数据库中的Award记录或rfqItem.itemStatus可能被错误地设置为豪中标。

## 操作步骤

### 1. 连接到数据库

```bash
mysql -u root -p your_database_name
```

### 2. 查询相关数据

```sql
-- 步骤1：查找询价单ID
SELECT id, rfqNo, status 
FROM rfqs 
WHERE rfqNo = 'RFQ-1764483069766';
```

**记录结果**：例如 `id = 'cmilbnu4n005akqz7ck2rvlmz'`

```sql
-- 步骤2：查找UR神光棒和MG艾比安的rfqItemId（替换YOUR_RFQ_ID）
SELECT id, productName, itemStatus, instantPrice
FROM rfq_items 
WHERE rfqId = 'YOUR_RFQ_ID' 
  AND productName IN ('UR神光棒', 'MG艾比安')
ORDER BY productName;
```

**记录结果**：
- UR神光棒: `id = 'YOUR_UR_RFQ_ITEM_ID'`, `instantPrice = 550.00`
- MG艾比安: `id = 'YOUR_MG_RFQ_ITEM_ID'`, `instantPrice = 185.00`

```sql
-- 步骤3：查找UR神光棒的所有报价（替换YOUR_UR_RFQ_ITEM_ID）
SELECT 
  qi.id as quote_item_id,
  qi.price,
  q.supplierId,
  u.username as supplier_name,
  ri.instantPrice
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.rfqItemId = 'YOUR_UR_RFQ_ITEM_ID'
ORDER BY qi.price ASC;
```

**确认**：
- 赛罗的报价应该是¥549.00（最低价，满足一口价¥550.00，应该中标）
- 豪的报价应该是¥550.00（等于一口价，但价格更高，不应该中标）

```sql
-- 步骤4：查找所有Award记录（替换YOUR_RFQ_ID）
SELECT 
  a.id as award_id,
  a.supplierId,
  u.username as supplier_name,
  a.finalPrice,
  a.reason
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = 'YOUR_RFQ_ID'
ORDER BY u.username;
```

**记录结果**：
- 豪的Award记录：`award_id = 'YOUR_HAO_AWARD_ID'`, `finalPrice = 738.00`（错误，应该只有MG艾比安¥188.00）
- 赛罗的Award记录：`award_id = 'YOUR_SAILUO_AWARD_ID'`, `finalPrice = 218.00`（错误，应该包含SHF歌查德¥218.00 + UR神光棒¥549.00 = ¥767.00）

```sql
-- 步骤5：检查UR神光棒的itemStatus和实际关联的报价（替换YOUR_UR_RFQ_ITEM_ID）
SELECT 
  ri.id,
  ri.productName,
  ri.itemStatus,
  qi.price,
  u.username as supplier_name
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE ri.id = 'YOUR_UR_RFQ_ITEM_ID'
ORDER BY qi.price ASC;
```

**确认**：
- `itemStatus` 应该是 `'AWARDED'`
- 应该关联到赛罗的报价（¥549.00），而不是豪的报价（¥550.00）

### 3. 执行修复

```sql
-- 开始事务
START TRANSACTION;

-- 步骤1：验证UR神光棒的中标供应商（通过价格比较）
-- 查找最低报价（应该是赛罗的¥549.00）
SELECT 
  qi.id as quote_item_id,
  qi.price,
  q.supplierId,
  u.username
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE qi.rfqItemId = 'YOUR_UR_RFQ_ITEM_ID'
ORDER BY qi.price ASC
LIMIT 1;
```

**记录结果**：应该是赛罗的报价，`supplierId = 'YOUR_SAILUO_SUPPLIER_ID'`

```sql
-- 步骤2：更新豪的Award记录finalPrice（只包含MG艾比安，替换YOUR_RFQ_ID和YOUR_HAO_AWARD_ID）
UPDATE awards a
INNER JOIN users u ON a.supplierId = u.id
SET a.finalPrice = (
  SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
  FROM quote_items qi
  INNER JOIN quotes q ON qi.quoteId = q.id
  INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
  WHERE q.supplierId = a.supplierId
    AND ri.rfqId = a.rfqId
    AND ri.itemStatus = 'AWARDED'
    AND ri.productName = 'MG艾比安'
),
a.updatedAt = NOW()
WHERE a.rfqId = 'YOUR_RFQ_ID'
  AND u.username = '豪';
```

```sql
-- 步骤3：更新赛罗的Award记录finalPrice（包含SHF歌查德 + UR神光棒，替换YOUR_RFQ_ID）
UPDATE awards a
INNER JOIN users u ON a.supplierId = u.id
SET a.finalPrice = (
  SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
  FROM quote_items qi
  INNER JOIN quotes q ON qi.quoteId = q.id
  INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
  WHERE q.supplierId = a.supplierId
    AND ri.rfqId = a.rfqId
    AND ri.itemStatus = 'AWARDED'
    AND ri.productName IN ('SHF歌查德', 'UR神光棒')
),
a.updatedAt = NOW()
WHERE a.rfqId = 'YOUR_RFQ_ID'
  AND u.username = '赛罗';
```

### 4. 验证修复结果

```sql
-- 验证Award记录
SELECT 
  a.id,
  u.username,
  a.finalPrice,
  COUNT(DISTINCT ri.id) as awarded_items_count,
  GROUP_CONCAT(ri.productName ORDER BY ri.productName SEPARATOR ', ') as products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = 'YOUR_RFQ_ID'
  AND ri.itemStatus = 'AWARDED'
GROUP BY a.id, u.username, a.finalPrice
ORDER BY u.username;
```

**预期结果**：
- 豪：`finalPrice = 188.00`, `products = 'MG艾比安'`
- 赛罗：`finalPrice = 767.00`, `products = 'SHF歌查德, UR神光棒'`

```sql
-- 验证UR神光棒的itemStatus和关联
SELECT 
  ri.id,
  ri.productName,
  ri.itemStatus,
  qi.price,
  u.username as supplier_name
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE ri.id = 'YOUR_UR_RFQ_ITEM_ID'
ORDER BY qi.price ASC;
```

**预期结果**：
- 应该显示赛罗的报价（¥549.00）中标

### 5. 提交事务

```sql
-- 如果验证通过，提交
COMMIT;

-- 如果发现问题，回滚
-- ROLLBACK;
```

## 完整操作示例

假设查询到的数据：
- rfqId: `cmilbnu4n005akqz7ck2rvlmz`
- UR神光棒rfqItemId: `cmilbnu6j005fkqz74c187ktx`
- 豪的Award ID: `cmilfxy8i0086kqz7os8zyww1`
- 赛罗的supplierId: `cmigt6kli0005kq0j3kybz0wq`

```bash
# 连接到数据库
mysql -u root -p your_database_name
```

```sql
-- 执行修复
START TRANSACTION;

-- 更新豪的Award记录（只包含MG艾比安）
UPDATE awards a
INNER JOIN users u ON a.supplierId = u.id
SET a.finalPrice = (
  SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
  FROM quote_items qi
  INNER JOIN quotes q ON qi.quoteId = q.id
  INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
  WHERE q.supplierId = a.supplierId
    AND ri.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
    AND ri.itemStatus = 'AWARDED'
    AND ri.productName = 'MG艾比安'
),
a.updatedAt = NOW()
WHERE a.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
  AND u.username = '豪';

-- 更新赛罗的Award记录（包含SHF歌查德 + UR神光棒）
UPDATE awards a
INNER JOIN users u ON a.supplierId = u.id
SET a.finalPrice = (
  SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
  FROM quote_items qi
  INNER JOIN quotes q ON qi.quoteId = q.id
  INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
  WHERE q.supplierId = a.supplierId
    AND ri.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
    AND ri.itemStatus = 'AWARDED'
    AND ri.productName IN ('SHF歌查德', 'UR神光棒')
),
a.updatedAt = NOW()
WHERE a.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
  AND u.username = '赛罗';

-- 验证
SELECT 
  a.id,
  u.username,
  a.finalPrice,
  GROUP_CONCAT(ri.productName ORDER BY ri.productName SEPARATOR ', ') as products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
  AND ri.itemStatus = 'AWARDED'
GROUP BY a.id, u.username, a.finalPrice
ORDER BY u.username;

COMMIT;
```

## 注意事项

1. **备份数据库**（重要！）
   ```bash
   mysqldump -u root -p your_database_name > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **使用事务**：所有修复SQL都在 `START TRANSACTION;` 和 `COMMIT;` 之间，如果发现问题可以 `ROLLBACK;`

3. **逐步执行**：先执行查询语句确认数据，再执行更新语句

4. **验证结果**：修复后务必执行验证SQL确认结果正确

5. **如果rfqItem.itemStatus错误**：如果UR神光棒的itemStatus被错误地设置为豪中标，需要先修复itemStatus，然后再更新Award记录

