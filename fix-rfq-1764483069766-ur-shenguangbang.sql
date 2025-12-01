-- 修复 RFQ-1764483069766 中 UR神光棒 的中标问题
-- 问题：UR神光棒应该由赛罗中标（549元），但显示在豪那里（550元）

-- 1. 首先查看当前的数据情况
SELECT 
  '=== 询价单信息 ===' as info;
SELECT 
  id,
  rfqNo,
  status
FROM rfqs
WHERE rfqNo = 'RFQ-1764483069766';

SELECT 
  '=== UR神光棒的商品信息 ===' as info;
SELECT 
  ri.id as rfq_item_id,
  ri.productName,
  ri.itemStatus,
  ri.instantPrice
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
  AND ri.productName LIKE '%UR神光棒%';

SELECT 
  '=== UR神光棒的所有报价 ===' as info;
SELECT 
  qi.id as quote_item_id,
  qi.price,
  q.id as quote_id,
  u.username as supplier_name,
  q.submittedAt,
  CASE 
    WHEN qi.price <= (SELECT instantPrice FROM rfq_items WHERE id = qi.rfqItemId) THEN '满足一口价'
    ELSE '不满足一口价'
  END as instant_price_check
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
  AND ri.productName LIKE '%UR神光棒%'
ORDER BY q.submittedAt ASC, qi.price ASC;

SELECT 
  '=== 所有 Award 记录 ===' as info;
SELECT 
  a.id as award_id,
  u.username as supplier_name,
  a.quoteId,
  a.finalPrice,
  a.reason
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN rfqs r ON a.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
ORDER BY a.createdAt;

SELECT 
  '=== 每个 Award 记录对应的商品 ===' as info;
SELECT 
  a.id as award_id,
  u.username as supplier_name,
  ri.productName,
  qi.price as quote_item_price,
  ri.itemStatus
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
ORDER BY a.id, ri.productName;

-- 2. 修复步骤
-- 假设问题：豪的 Award 记录中的 quote 包含了 UR神光棒的 quoteItem
-- 但 UR神光棒应该由赛罗中标（价格更低：549 vs 550，且赛罗先提交）

-- 2.1 查找 UR神光棒的 rfqItemId
SET @ur_rfq_item_id = (
  SELECT ri.id
  FROM rfq_items ri
  INNER JOIN rfqs r ON ri.rfqId = r.id
  WHERE r.rfqNo = 'RFQ-1764483069766'
    AND ri.productName LIKE '%UR神光棒%'
  LIMIT 1
);

-- 2.2 查找赛罗的 quoteId（UR神光棒，549元）
SET @sailuo_quote_id = (
  SELECT q.id
  FROM quotes q
  INNER JOIN users u ON q.supplierId = u.id
  INNER JOIN quote_items qi ON q.id = qi.quoteId
  WHERE qi.rfqItemId = @ur_rfq_item_id
    AND u.username = '赛罗'
    AND qi.price = 549.00
  LIMIT 1
);

-- 2.3 查找豪的 quoteId（UR神光棒，550元）
SET @hao_quote_id = (
  SELECT q.id
  FROM quotes q
  INNER JOIN users u ON q.supplierId = u.id
  INNER JOIN quote_items qi ON q.id = qi.quoteId
  WHERE qi.rfqItemId = @ur_rfq_item_id
    AND u.username = '豪'
    AND qi.price = 550.00
  LIMIT 1
);

-- 2.4 查找赛罗的 Award 记录
SET @sailuo_award_id = (
  SELECT a.id
  FROM awards a
  INNER JOIN users u ON a.supplierId = u.id
  INNER JOIN rfqs r ON a.rfqId = r.id
  WHERE r.rfqNo = 'RFQ-1764483069766'
    AND u.username = '赛罗'
  LIMIT 1
);

-- 2.5 查找豪的 Award 记录
SET @hao_award_id = (
  SELECT a.id
  FROM awards a
  INNER JOIN users u ON a.supplierId = u.id
  INNER JOIN rfqs r ON a.rfqId = r.id
  WHERE r.rfqNo = 'RFQ-1764483069766'
    AND u.username = '豪'
  LIMIT 1
);

-- 显示找到的ID
SELECT 
  '=== 找到的ID ===' as info,
  @ur_rfq_item_id as ur_rfq_item_id,
  @sailuo_quote_id as sailuo_quote_id,
  @hao_quote_id as hao_quote_id,
  @sailuo_award_id as sailuo_award_id,
  @hao_award_id as hao_award_id;

-- 3. 修复逻辑
-- 3.1 如果赛罗没有 Award 记录，创建一个
-- 3.2 如果豪的 Award 记录中的 quote 包含了 UR神光棒，需要：
--     - 确保赛罗的 Award 记录中的 quote 包含 UR神光棒
--     - 更新豪的 Award 记录的 finalPrice（减去 UR神光棒的 550元）
--     - 更新赛罗的 Award 记录的 finalPrice（加上 UR神光棒的 549元）

-- ⚠️ 注意：这个修复需要根据实际数据情况调整
-- 建议先执行查询部分，查看实际数据，然后根据情况执行修复

-- 3.3 修复示例（需要根据实际数据调整）
/*
-- 如果赛罗没有 Award 记录，创建
INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt)
SELECT 
  CONCAT('award_', UNIX_TIMESTAMP(), '_', FLOOR(RAND() * 1000)) as id,
  r.id as rfqId,
  @sailuo_quote_id as quoteId,
  (SELECT id FROM users WHERE username = '赛罗' LIMIT 1) as supplierId,
  (SELECT SUM(qi.price * COALESCE(ri.quantity, 1))
   FROM quote_items qi
   INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
   WHERE qi.quoteId = @sailuo_quote_id
     AND ri.itemStatus = 'AWARDED') as finalPrice,
  '系统自动评标：按商品级别最优报价' as reason,
  'ACTIVE' as status,
  NOW() as createdAt,
  NOW() as updatedAt
FROM rfqs r
WHERE r.rfqNo = 'RFQ-1764483069766'
LIMIT 1;

-- 更新豪的 Award 记录的 finalPrice（减去 UR神光棒的 550元）
UPDATE awards
SET finalPrice = finalPrice - 550.00,
    updatedAt = NOW()
WHERE id = @hao_award_id;

-- 更新赛罗的 Award 记录的 finalPrice（加上 UR神光棒的 549元）
UPDATE awards
SET finalPrice = finalPrice + 549.00,
    updatedAt = NOW()
WHERE id = @sailuo_award_id;
*/

