-- 简单验证脚本：直接查询数据库状态

SET @rfq_no = 'RFQ-1764483069766';
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);
SET @rfq_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName LIKE '%UR神光棒%' LIMIT 1);

-- 1. 查看所有对 UR神光棒 的报价项
SELECT '=== 所有对 UR神光棒 的报价项 ===' AS section;
SELECT 
    qi.id AS quote_item_id,
    q.id AS quote_id,
    u.username AS supplier_name,
    qi.price,
    CASE WHEN a.id IS NOT NULL AND a.status != 'CANCELLED' THEN '有Award' ELSE '无Award' END AS has_award,
    a.id AS award_id,
    a.status AS award_status
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE qi.rfqItemId = @rfq_item_id
ORDER BY qi.price ASC;

-- 2. 查看赛罗的 Quote 包含哪些商品
SELECT '=== 赛罗的 Quote 包含的商品 ===' AS section;
SELECT 
    qi.id AS quote_item_id,
    ri.productName,
    qi.price
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE q.rfqId = @rfq_id
  AND u.username COLLATE utf8mb4_unicode_ci = '赛罗' COLLATE utf8mb4_unicode_ci
ORDER BY ri.productName;

-- 3. 查看豪的 Quote 包含哪些商品
SELECT '=== 豪的 Quote 包含的商品 ===' AS section;
SELECT 
    qi.id AS quote_item_id,
    ri.productName,
    qi.price
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE q.rfqId = @rfq_id
  AND u.username COLLATE utf8mb4_unicode_ci = '豪' COLLATE utf8mb4_unicode_ci
ORDER BY ri.productName;

-- 4. 查看所有 Award 记录
SELECT '=== 所有 Award 记录 ===' AS section;
SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status,
    a.finalPrice,
    GROUP_CONCAT(ri.productName ORDER BY ri.productName) AS products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
GROUP BY a.id, u.username, a.status, a.finalPrice
ORDER BY u.username;

