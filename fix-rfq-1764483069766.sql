-- ============================================
-- 修复 RFQ-1764483069766 数据不一致问题
-- 问题：UR神光棒在"按商品选商"显示赛罗中标（¥549），但在"中标订单物流信息"显示豪中标（¥550）
-- ============================================

-- ============================================
-- 第一步：查询相关数据
-- ============================================

-- 1. 查找询价单ID
SELECT id, rfqNo, status, createdAt 
FROM rfqs 
WHERE rfqNo = 'RFQ-1764483069766';

-- 记录结果：假设 rfqId = 'YOUR_RFQ_ID'

-- 2. 查找UR神光棒和MG艾比安的rfqItemId
SELECT id, productName, itemStatus, rfqId, instantPrice, maxPrice
FROM rfq_items 
WHERE rfqId = 'YOUR_RFQ_ID' 
  AND productName IN ('UR神光棒', 'MG艾比安')
ORDER BY productName;

-- 记录结果：
-- UR神光棒: rfqItemId = 'YOUR_UR_RFQ_ITEM_ID'
-- MG艾比安: rfqItemId = 'YOUR_MG_RFQ_ITEM_ID'

-- 3. 查找UR神光棒的所有报价
SELECT 
  qi.id as quote_item_id,
  qi.quoteId,
  qi.rfqItemId,
  qi.price,
  q.supplierId,
  u.username as supplier_name,
  ri.productName,
  ri.itemStatus,
  ri.instantPrice
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.rfqItemId = 'YOUR_UR_RFQ_ITEM_ID'
ORDER BY qi.price ASC;

-- 确认：
-- 赛罗的报价应该是¥549.00（最低价，应该中标）
-- 豪的报价应该是¥550.00（高于一口价¥550.00，不应该中标）

-- 4. 查找MG艾比安的所有报价
SELECT 
  qi.id as quote_item_id,
  qi.quoteId,
  qi.rfqItemId,
  qi.price,
  q.supplierId,
  u.username as supplier_name,
  ri.productName,
  ri.itemStatus,
  ri.instantPrice
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.rfqItemId = 'YOUR_MG_RFQ_ITEM_ID'
ORDER BY qi.price ASC;

-- 确认：
-- 豪的报价应该是¥188.00（最低价，应该中标）

-- 5. 查找所有Award记录
SELECT 
  a.id as award_id,
  a.rfqId,
  a.quoteId,
  a.supplierId,
  u.username as supplier_name,
  a.finalPrice,
  a.status,
  a.reason,
  a.createdAt
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = 'YOUR_RFQ_ID'
ORDER BY u.username;

-- 记录结果：
-- 豪的Award记录：award_id = 'YOUR_HAO_AWARD_ID', finalPrice应该包含MG艾比安和UR神光棒
-- 赛罗的Award记录：award_id = 'YOUR_SAILUO_AWARD_ID', finalPrice应该只包含SHF歌查德和UR神光棒

-- 6. 检查UR神光棒的itemStatus和关联的报价
SELECT 
  ri.id as rfq_item_id,
  ri.productName,
  ri.itemStatus,
  ri.instantPrice,
  qi.id as quote_item_id,
  qi.price,
  q.supplierId,
  u.username as supplier_name
FROM rfq_items ri
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users u ON q.supplierId = u.id
WHERE ri.id = 'YOUR_UR_RFQ_ITEM_ID'
ORDER BY qi.price ASC;

-- 确认：
-- itemStatus应该是'AWARDED'
-- 应该关联到赛罗的报价（¥549.00），而不是豪的报价（¥550.00）

-- 7. 检查发货单（如果有）
SELECT 
  s.id as shipment_id,
  s.rfqItemId,
  s.supplierId,
  u.username as supplier_name,
  s.trackingNo,
  ri.productName
FROM shipments s
INNER JOIN users u ON s.supplierId = u.id
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE ri.rfqId = 'YOUR_RFQ_ID'
  AND ri.productName IN ('UR神光棒', 'MG艾比安')
ORDER BY ri.productName, u.username;

-- ============================================
-- 第二步：执行修复
-- ============================================

-- 开始事务
START TRANSACTION;

-- 1. 验证UR神光棒的中标供应商（通过价格比较）
-- 如果itemStatus已经是'AWARDED'，但关联的是豪的报价，需要修复

-- 1.1 查找UR神光棒的最低报价（应该是赛罗的¥549.00）
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

-- 记录结果：应该是赛罗的报价，supplierId = 'YOUR_SAILUO_SUPPLIER_ID'

-- 2. 检查UR神光棒的itemStatus是否正确
-- 如果itemStatus是'AWARDED'，但关联的报价不是最低价，需要修复

-- 3. 修复UR神光棒的itemStatus（如果需要）
-- 注意：如果itemStatus已经是'AWARDED'，但关联错误，可能需要重置后重新设置
-- 但通常itemStatus应该是正确的，问题可能出在Award记录

-- 4. 检查并修复Award记录
-- 4.1 检查豪的Award记录是否错误地包含了UR神光棒
SELECT 
  a.id as award_id,
  a.supplierId,
  u.username,
  a.finalPrice,
  -- 计算豪实际应该中标的商品总价（只有MG艾比安）
  (SELECT COALESCE(SUM(qi2.price * COALESCE(ri2.quantity, 1)), 0)
   FROM quote_items qi2
   INNER JOIN quotes q2 ON qi2.quoteId = q2.id
   INNER JOIN rfq_items ri2 ON qi2.rfqItemId = ri2.id
   WHERE q2.supplierId = a.supplierId
     AND ri2.rfqId = a.rfqId
     AND ri2.itemStatus = 'AWARDED'
     AND ri2.productName = 'MG艾比安'
  ) as should_be_price
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = 'YOUR_RFQ_ID'
  AND u.username = '豪';

-- 4.2 检查赛罗的Award记录是否应该包含UR神光棒
SELECT 
  a.id as award_id,
  a.supplierId,
  u.username,
  a.finalPrice,
  -- 计算赛罗实际应该中标的商品总价（SHF歌查德 + UR神光棒）
  (SELECT COALESCE(SUM(qi2.price * COALESCE(ri2.quantity, 1)), 0)
   FROM quote_items qi2
   INNER JOIN quotes q2 ON qi2.quoteId = q2.id
   INNER JOIN rfq_items ri2 ON qi2.rfqItemId = ri2.id
   WHERE q2.supplierId = a.supplierId
     AND ri2.rfqId = a.rfqId
     AND ri2.itemStatus = 'AWARDED'
     AND ri2.productName IN ('SHF歌查德', 'UR神光棒')
  ) as should_be_price
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = 'YOUR_RFQ_ID'
  AND u.username = '赛罗';

-- 5. 更新Award记录的finalPrice（根据实际中标的商品）
-- 5.1 更新豪的Award记录（只包含MG艾比安）
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

-- 5.2 更新赛罗的Award记录（包含SHF歌查德 + UR神光棒）
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

-- 6. 验证修复结果
-- 6.1 验证UR神光棒的itemStatus和关联
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

-- 6.2 验证Award记录
SELECT 
  a.id,
  u.username,
  a.finalPrice,
  COUNT(DISTINCT ri.id) as awarded_items_count,
  GROUP_CONCAT(ri.productName ORDER BY ri.productName) as products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = 'YOUR_RFQ_ID'
  AND ri.itemStatus = 'AWARDED'
GROUP BY a.id, u.username, a.finalPrice
ORDER BY u.username;

-- 提交事务
COMMIT;

-- ============================================
-- 如果发现问题，可以回滚
-- ============================================
-- ROLLBACK;

