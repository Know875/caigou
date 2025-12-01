# 使用 fix-shipment-supplier-id.sql 脚本修复数据库

## 方法一：在MySQL命令行中执行（推荐）

### 1. 连接到数据库

```bash
mysql -u root -p your_database_name
```

### 2. 执行SQL脚本

```bash
# 方式1：在MySQL命令行中执行
mysql -u root -p your_database_name < fix-shipment-supplier-id.sql

# 方式2：在MySQL命令行中执行（如果脚本在服务器上）
mysql -u root -p your_database_name < /path/to/fix-shipment-supplier-id.sql

# 方式3：在MySQL命令行中执行（使用source命令）
mysql -u root -p your_database_name
mysql> source /path/to/fix-shipment-supplier-id.sql
```

### 3. 或者直接在MySQL中复制粘贴SQL语句

```bash
# 1. 连接到数据库
mysql -u root -p your_database_name

# 2. 在MySQL命令行中，复制粘贴SQL脚本中的查询语句
# 3. 根据查询结果，替换变量后执行修复SQL
```

## 方法二：分步执行（更安全，推荐）

### 步骤1：连接到数据库

```bash
mysql -u root -p your_database_name
```

### 步骤2：执行查询语句（获取实际数据）

```sql
-- 1. 查找询价单ID
SELECT id, rfqNo, status 
FROM rfqs 
WHERE id IN (
  SELECT DISTINCT rfqId 
  FROM rfq_items 
  WHERE productName LIKE '%UR神光棒%'
)
ORDER BY createdAt DESC;
```

**记录结果**：例如 `id = 'cmilbnu4n005akqz7ck2rvlmz'`

```sql
-- 2. 查找UR神光棒商品的rfqItemId（替换YOUR_RFQ_ID）
SELECT id, productName, itemStatus, rfqId
FROM rfq_items 
WHERE rfqId = 'YOUR_RFQ_ID' 
  AND productName LIKE '%UR神光棒%';
```

**记录结果**：例如 `id = 'cmilbnu6j005fkqz74c187ktx'`

```sql
-- 3. 查找该商品的所有报价（替换YOUR_RFQ_ITEM_ID）
SELECT 
  qi.id as quote_item_id,
  qi.price,
  q.supplierId,
  u.username as supplier_name
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE qi.rfqItemId = 'YOUR_RFQ_ITEM_ID'
ORDER BY qi.price ASC;
```

**记录结果**：
- "赛罗"的supplierId（应该是价格最低的）
- "豪"的supplierId

```sql
-- 4. 查找该商品的所有发货单（替换YOUR_RFQ_ITEM_ID）
SELECT 
  s.id as shipment_id,
  s.supplierId,
  u.username as supplier_name,
  s.trackingNo
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
WHERE s.rfqItemId = 'YOUR_RFQ_ITEM_ID';
```

**记录结果**：
- shipment_id（发货单ID）
- 当前supplierId（错误的，应该是"豪"的ID）

### 步骤3：执行修复SQL（替换变量）

```sql
-- 开始事务
START TRANSACTION;

-- 替换以下变量为实际值：
-- YOUR_SHIPMENT_ID: 发货单ID
-- WRONG_SUPPLIER_ID: "豪"的供应商ID
-- CORRECT_SUPPLIER_ID: "赛罗"的供应商ID
-- YOUR_RFQ_ITEM_ID: rfqItemId

UPDATE shipments
SET supplierId = 'CORRECT_SUPPLIER_ID',
    updatedAt = NOW()
WHERE id = 'YOUR_SHIPMENT_ID'
  AND supplierId = 'WRONG_SUPPLIER_ID'
  AND rfqItemId = 'YOUR_RFQ_ITEM_ID';

-- 验证结果
SELECT 
  s.id,
  s.supplierId,
  u.username as supplier_name,
  ri.productName
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE s.id = 'YOUR_SHIPMENT_ID';

-- 如果结果正确，提交事务
COMMIT;

-- 如果结果不正确，回滚事务
-- ROLLBACK;
```

## 方法三：使用实际示例

假设查询到的数据如下：
- rfqId: `cmilbnu4n005akqz7ck2rvlmz`
- rfqItemId: `cmilbnu6j005fkqz74c187ktx`
- shipment_id: `cmilfxy8i0086kqz7os8zyww1`
- 错误的supplierId（豪）: `cmigt6kli0004kq0j3kybz0wp`
- 正确的supplierId（赛罗）: `cmigt6kli0005kq0j3kybz0wq`

```bash
# 1. 连接到数据库
mysql -u root -p your_database_name
```

```sql
-- 2. 执行修复
START TRANSACTION;

UPDATE shipments
SET supplierId = 'cmigt6kli0005kq0j3kybz0wq',  -- 赛罗的ID
    updatedAt = NOW()
WHERE id = 'cmilfxy8i0086kqz7os8zyww1'  -- 发货单ID
  AND supplierId = 'cmigt6kli0004kq0j3kybz0wp'  -- 豪的ID
  AND rfqItemId = 'cmilbnu6j005fkqz74c187ktx';  -- UR神光棒的rfqItemId

-- 3. 验证
SELECT s.id, s.supplierId, u.username, ri.productName
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE s.id = 'cmilfxy8i0086kqz7os8zyww1';

-- 4. 如果验证通过，提交
COMMIT;
```

## 完整操作流程（推荐）

```bash
# 1. SSH连接到服务器
ssh user@your_server

# 2. 进入项目目录（如果脚本在项目目录中）
cd /path/to/caigou

# 3. 连接到MySQL数据库
mysql -u root -p your_database_name

# 4. 在MySQL中执行查询语句获取数据
# （复制粘贴 fix-shipment-supplier-id.sql 中的查询语句）

# 5. 根据查询结果，替换变量后执行修复SQL
# （复制粘贴 fix-shipment-supplier-id.sql 中的修复SQL，替换变量）

# 6. 验证结果

# 7. 退出MySQL
exit;
```

## 注意事项

1. **备份数据库**（重要！）
   ```bash
   mysqldump -u root -p your_database_name > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **使用事务**：所有修复SQL都在 `START TRANSACTION;` 和 `COMMIT;` 之间，如果发现问题可以 `ROLLBACK;`

3. **逐步执行**：先执行查询语句确认数据，再执行更新语句

4. **验证结果**：修复后务必执行验证SQL确认结果正确

5. **替换变量**：SQL脚本中的变量（如 `@RFQ_ID`、`@SHIPMENT_ID` 等）需要替换为实际查询到的值

## 快速命令总结

```bash
# 连接到数据库
mysql -u root -p your_database_name

# 在MySQL中执行（需要先替换变量）
source /path/to/fix-shipment-supplier-id.sql

# 或者直接执行SQL文件
mysql -u root -p your_database_name < fix-shipment-supplier-id.sql
```

