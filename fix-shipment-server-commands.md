# 修复发货单supplierId错误 - 服务器操作指南

## 第一步：连接到MySQL数据库

```bash
# 方式1：直接连接（需要输入密码）
mysql -u root -p

# 方式2：如果知道数据库名，直接连接
mysql -u root -p your_database_name

# 方式3：如果使用远程连接
mysql -h your_host -u root -p your_database_name
```

## 第二步：查询相关数据

### 1. 查找询价单ID（根据商品名称）

```sql
-- 查找包含"UR神光棒"的询价单
SELECT id, rfqNo, status, createdAt 
FROM rfqs 
WHERE id IN (
  SELECT DISTINCT rfqId 
  FROM rfq_items 
  WHERE productName LIKE '%UR神光棒%'
)
ORDER BY createdAt DESC;
```

**记录结果**：找到包含UR神光棒的询价单ID，例如：`cmilbnu4n005akqz7ck2rvlmz`

### 2. 查找UR神光棒商品的rfqItemId

```sql
-- 替换 'YOUR_RFQ_ID' 为上面查询到的询价单ID
SELECT id, productName, itemStatus, rfqId, instantPrice, maxPrice
FROM rfq_items 
WHERE rfqId = 'YOUR_RFQ_ID' 
  AND productName LIKE '%UR神光棒%';
```

**记录结果**：找到UR神光棒的rfqItemId，例如：`cmilbnu6j005fkqz74c187ktx`

### 3. 查找该商品的所有报价

```sql
-- 替换 'YOUR_RFQ_ITEM_ID' 为上面查询到的rfqItemId
SELECT 
  qi.id as quote_item_id,
  qi.quoteId,
  qi.rfqItemId,
  qi.price,
  q.supplierId,
  u.username as supplier_name,
  ri.productName,
  ri.itemStatus
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.rfqItemId = 'YOUR_RFQ_ITEM_ID'
ORDER BY qi.price ASC, u.username;
```

**确认**：
- "赛罗"的报价价格（应该是最低价）
- "豪"的报价价格
- 中标供应商应该是"赛罗"

### 4. 查找该商品的所有发货单

```sql
-- 替换 'YOUR_RFQ_ITEM_ID' 为上面查询到的rfqItemId
SELECT 
  s.id as shipment_id,
  s.shipmentNo,
  s.rfqItemId,
  s.supplierId,
  u.username as supplier_name,
  s.trackingNo,
  s.carrier,
  s.status,
  s.createdAt,
  ri.productName
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE s.rfqItemId = 'YOUR_RFQ_ITEM_ID'
ORDER BY s.createdAt DESC;
```

**记录结果**：
- 发货单ID（shipment_id）
- 当前supplierId（应该是"豪"的ID，这是错误的）
- 当前supplier_name（应该是"豪"）

### 5. 查找中标供应商ID

```sql
-- 方法1：通过Award记录查找（如果有）
SELECT 
  a.id as award_id,
  a.supplierId,
  u.username as supplier_name,
  qi.id as quote_item_id,
  qi.price,
  ri.productName
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN users u ON a.supplierId = u.id
WHERE qi.rfqItemId = 'YOUR_RFQ_ITEM_ID'
  AND ri.itemStatus = 'AWARDED';
```

```sql
-- 方法2：通过价格最低的报价查找（如果没有Award记录）
SELECT 
  qi.id as quote_item_id,
  qi.quoteId,
  qi.price,
  q.supplierId,
  u.username as supplier_name,
  ri.productName,
  ri.itemStatus
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.rfqItemId = 'YOUR_RFQ_ITEM_ID'
  AND ri.itemStatus = 'AWARDED'
ORDER BY qi.price ASC
LIMIT 1;
```

**记录结果**：
- 正确的供应商ID（supplierId，应该是"赛罗"的ID）
- 正确的供应商名称（supplier_name，应该是"赛罗"）

## 第三步：执行修复

### 开始事务

```sql
START TRANSACTION;
```

### 验证发货单的supplierId是否错误

```sql
-- 替换 'YOUR_SHIPMENT_ID' 为步骤4查询到的shipment_id
SELECT 
  s.id,
  s.supplierId as current_supplier_id,
  u1.username as current_supplier_name,
  ri.productName,
  ri.itemStatus,
  -- 查找中标供应商
  (SELECT u2.username 
   FROM quote_items qi2
   INNER JOIN quotes q2 ON qi2.quoteId = q2.id
   INNER JOIN users u2 ON q2.supplierId = u2.id
   WHERE qi2.rfqItemId = s.rfqItemId
     AND ri.itemStatus = 'AWARDED'
   ORDER BY qi2.price ASC
   LIMIT 1) as winning_supplier_name
FROM shipments s
INNER JOIN users u1 ON s.supplierId = u1.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE s.id = 'YOUR_SHIPMENT_ID';
```

**确认**：
- `current_supplier_name` 应该是"豪"（错误）
- `winning_supplier_name` 应该是"赛罗"（正确）

### 更新发货单的supplierId

```sql
-- 替换以下变量：
-- YOUR_SHIPMENT_ID: 发货单ID（从步骤4查询得到）
-- WRONG_SUPPLIER_ID: "豪"的供应商ID（从步骤4查询得到）
-- CORRECT_SUPPLIER_ID: "赛罗"的供应商ID（从步骤5查询得到）
-- YOUR_RFQ_ITEM_ID: rfqItemId（从步骤2查询得到）

UPDATE shipments
SET supplierId = 'CORRECT_SUPPLIER_ID',
    updatedAt = NOW()
WHERE id = 'YOUR_SHIPMENT_ID'
  AND supplierId = 'WRONG_SUPPLIER_ID'
  AND rfqItemId = 'YOUR_RFQ_ITEM_ID';
```

**示例**（替换为实际值）：
```sql
UPDATE shipments
SET supplierId = 'cmigt6kli0005kq0j3kybz0wq',  -- 赛罗的ID
    updatedAt = NOW()
WHERE id = 'cmilfxy8i0086kqz7os8zyww1'  -- 发货单ID
  AND supplierId = 'cmigt6kli0004kq0j3kybz0wp'  -- 豪的ID
  AND rfqItemId = 'cmilbnu6j005fkqz74c187ktx';  -- UR神光棒的rfqItemId
```

### 验证更新结果

```sql
-- 替换 'YOUR_SHIPMENT_ID' 为发货单ID
SELECT 
  s.id,
  s.supplierId,
  u.username as supplier_name,
  ri.productName,
  s.trackingNo,
  s.carrier
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE s.id = 'YOUR_SHIPMENT_ID';
```

**确认**：
- `supplier_name` 现在应该是"赛罗"（正确）

### 提交事务

```sql
COMMIT;
```

**如果发现问题，可以回滚**：
```sql
ROLLBACK;
```

## 第四步：批量修复（如果需要修复多个发货单）

### 查找所有supplierId错误的发货单

```sql
SELECT 
  s.id as shipment_id,
  s.rfqItemId,
  s.supplierId as wrong_supplier_id,
  u1.username as wrong_supplier_name,
  ri.productName,
  ri.itemStatus,
  -- 查找正确的供应商ID
  (SELECT q2.supplierId
   FROM quote_items qi2
   INNER JOIN quotes q2 ON qi2.quoteId = q2.id
   WHERE qi2.rfqItemId = s.rfqItemId
     AND ri.itemStatus = 'AWARDED'
   ORDER BY qi2.price ASC
   LIMIT 1) as correct_supplier_id,
  (SELECT u2.username
   FROM quote_items qi2
   INNER JOIN quotes q2 ON qi2.quoteId = q2.id
   INNER JOIN users u2 ON q2.supplierId = u2.id
   WHERE qi2.rfqItemId = s.rfqItemId
     AND ri.itemStatus = 'AWARDED'
   ORDER BY qi2.price ASC
   LIMIT 1) as correct_supplier_name
FROM shipments s
INNER JOIN users u1 ON s.supplierId = u1.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE ri.itemStatus = 'AWARDED'
  AND s.supplierId != (
    -- 查找中标供应商ID
    SELECT q2.supplierId
    FROM quote_items qi2
    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
    WHERE qi2.rfqItemId = s.rfqItemId
    ORDER BY qi2.price ASC
    LIMIT 1
  );
```

### 批量更新（谨慎使用，建议先执行上面的查询确认数据）

```sql
START TRANSACTION;

-- 批量更新发货单的supplierId
UPDATE shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
INNER JOIN (
  SELECT 
    qi.rfqItemId,
    q.supplierId as correct_supplier_id
  FROM quote_items qi
  INNER JOIN quotes q ON qi.quoteId = q.id
  INNER JOIN rfq_items ri2 ON qi.rfqItemId = ri2.id
  WHERE ri2.itemStatus = 'AWARDED'
  GROUP BY qi.rfqItemId, q.supplierId
  HAVING MIN(qi.price) = (
    SELECT MIN(qi2.price)
    FROM quote_items qi2
    WHERE qi2.rfqItemId = qi.rfqItemId
  )
) as correct_suppliers ON s.rfqItemId = correct_suppliers.rfqItemId
SET s.supplierId = correct_suppliers.correct_supplier_id,
    s.updatedAt = NOW()
WHERE ri.itemStatus = 'AWARDED'
  AND s.supplierId != correct_suppliers.correct_supplier_id;

-- 查看更新了多少条记录
SELECT ROW_COUNT() as updated_rows;

-- 验证结果
SELECT 
  s.id,
  s.supplierId,
  u.username,
  ri.productName
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE ri.itemStatus = 'AWARDED'
  AND s.updatedAt > DATE_SUB(NOW(), INTERVAL 1 MINUTE);

COMMIT;
```

## 完整操作示例

```bash
# 1. 连接到数据库
mysql -u root -p your_database_name

# 2. 在MySQL中执行以下SQL（替换为实际值）
```

```sql
-- 查找询价单
SELECT id, rfqNo FROM rfqs WHERE id IN (
  SELECT DISTINCT rfqId FROM rfq_items WHERE productName LIKE '%UR神光棒%'
) LIMIT 1;

-- 假设找到的rfqId是: cmilbnu4n005akqz7ck2rvlmz
-- 假设找到的rfqItemId是: cmilbnu6j005fkqz74c187ktx

-- 查找发货单
SELECT s.id, s.supplierId, u.username, ri.productName
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE ri.productName LIKE '%UR神光棒%'
  AND ri.itemStatus = 'AWARDED';

-- 假设找到的shipment_id是: cmilfxy8i0086kqz7os8zyww1
-- 当前supplierId是: cmigt6kli0004kq0j3kybz0wp (豪)

-- 查找正确的供应商ID（赛罗）
SELECT q.supplierId, u.username
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE qi.rfqItemId = 'cmilbnu6j005fkqz74c187ktx'
ORDER BY qi.price ASC
LIMIT 1;

-- 假设找到的正确的supplierId是: cmigt6kli0005kq0j3kybz0wq (赛罗)

-- 执行修复
START TRANSACTION;

UPDATE shipments
SET supplierId = 'cmigt6kli0005kq0j3kybz0wq',  -- 赛罗的ID
    updatedAt = NOW()
WHERE id = 'cmilfxy8i0086kqz7os8zyww1';  -- 发货单ID

-- 验证
SELECT s.id, s.supplierId, u.username, ri.productName
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE s.id = 'cmilfxy8i0086kqz7os8zyww1';

COMMIT;
```

## 注意事项

1. **备份数据**：在执行修复SQL之前，建议先备份数据库
   ```bash
   mysqldump -u root -p your_database_name > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **使用事务**：所有修复SQL都在事务中执行，如果发现问题可以回滚

3. **逐步执行**：建议先执行查询语句确认数据，再执行更新语句

4. **验证结果**：修复后务必执行验证SQL确认结果正确

5. **测试环境**：如果可能，先在测试环境验证SQL语句

