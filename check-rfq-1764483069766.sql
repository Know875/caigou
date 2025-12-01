-- 检查 RFQ-1764483069766 的数据情况
-- 重点关注 UR神光棒 的中标情况

-- 1. 查看询价单基本信息
SELECT 
  id,
  rfqNo,
  status,
  title
FROM rfqs
WHERE rfqNo = 'RFQ-1764483069766';

-- 2. 查看 UR神光棒 的商品信息
SELECT 
  ri.id as rfq_item_id,
  ri.productName,
  ri.itemStatus,
  ri.instantPrice,
  ri.maxPrice,
  ri.orderNo
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
  AND ri.productName LIKE '%UR神光棒%';

-- 3. 查看 UR神光棒 的所有报价
SELECT 
  qi.id as quote_item_id,
  qi.price,
  q.id as quote_id,
  q.supplierId,
  u.username as supplier_name,
  q.status as quote_status,
  q.submittedAt
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
  AND ri.productName LIKE '%UR神光棒%'
ORDER BY qi.price ASC, q.submittedAt ASC;

-- 4. 查看所有 Award 记录
SELECT 
  a.id as award_id,
  a.rfqId,
  a.supplierId,
  u.username as supplier_name,
  a.finalPrice,
  a.reason,
  a.status as award_status,
  a.createdAt
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN rfqs r ON a.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
ORDER BY a.createdAt;

-- 5. 查看每个 Award 记录对应的商品（通过 quote.items）
SELECT 
  a.id as award_id,
  u.username as supplier_name,
  a.finalPrice,
  qi.rfqItemId,
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

-- 6. 查看豪的整单报价包含哪些商品
SELECT 
  q.id as quote_id,
  u.username as supplier_name,
  q.status as quote_status,
  q.price as quote_total_price,
  qi.rfqItemId,
  ri.productName,
  qi.price as quote_item_price,
  ri.itemStatus
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
  AND u.username = '豪'
ORDER BY ri.productName;

-- 7. 查看赛罗的整单报价包含哪些商品
SELECT 
  q.id as quote_id,
  u.username as supplier_name,
  q.status as quote_status,
  q.price as quote_total_price,
  qi.rfqItemId,
  ri.productName,
  qi.price as quote_item_price,
  ri.itemStatus
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764483069766'
  AND u.username = '赛罗'
ORDER BY ri.productName;

-- 8. 检查 UR神光棒 的实际中标情况（通过 Award 记录中的 quote.items）
SELECT 
  ri.id as rfq_item_id,
  ri.productName,
  ri.itemStatus,
  a.id as award_id,
  u.username as supplier_name,
  qi.id as quote_item_id,
  qi.price as quote_item_price,
  q.id as quote_id,
  q.submittedAt as quote_submitted_at
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN awards a ON a.rfqId = r.id
LEFT JOIN quotes q ON a.quoteId = q.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId AND qi.rfqItemId = ri.id
LEFT JOIN users u ON a.supplierId = u.id
WHERE r.rfqNo = 'RFQ-1764483069766'
  AND ri.productName LIKE '%UR神光棒%'
ORDER BY a.id, q.submittedAt;

