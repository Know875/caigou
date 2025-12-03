-- 修复 RFQ-1764735881464：重新评标没有 ACTIVE Award 的商品
-- 注意：这个脚本只是检查和准备数据，实际修复需要通过 API 重新触发自动评标

SET @rfq_no = 'RFQ-1764735881464';
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);

-- 1. 查找所有状态为 AWARDED 但没有 ACTIVE Award 的商品
SELECT '=== 需要重新评标的商品 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT u.username ORDER BY u.username) AS suppliers_with_award
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN quote_items qi ON qi.rfqItemId = ri.id
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
LEFT JOIN users u ON a.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.item_status = 'AWARDED'
GROUP BY ri.id, ri.productName, ri.item_status, ri.instant_price, ri.max_price
HAVING COUNT(DISTINCT a.id) = 0
ORDER BY ri.productName;

-- 2. 查找每个商品的所有报价（按价格排序）
SELECT '=== 每个商品的所有报价（按价格排序） ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    u.username AS supplier_name,
    qi.price,
    q.submittedAt,
    q.status AS quote_status,
    CASE WHEN a.id IS NOT NULL AND a.status != 'CANCELLED' THEN '有Award' ELSE '无Award' END AS has_award
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName, qi.price ASC, q.submittedAt ASC;

-- 3. 查找有 ACTIVE Award 但价格不是最低的商品
SELECT '=== 有 ACTIVE Award 但价格不是最低的商品 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    a.supplierId AS award_supplier_id,
    u1.username AS award_supplier_name,
    qi1.price AS award_price,
    a.id AS award_id,
    MIN(qi2.price) AS min_price,
    (SELECT u2.username FROM quote_items qi3 
     INNER JOIN quotes q3 ON qi3.quoteId = q3.id 
     INNER JOIN users u2 ON q3.supplierId = u2.id
     WHERE qi3.rfqItemId = ri.id 
     ORDER BY qi3.price ASC, q3.submittedAt ASC 
     LIMIT 1) AS min_price_supplier
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi1 ON qi1.rfqItemId = ri.id
INNER JOIN quotes q1 ON qi1.quoteId = q1.id
INNER JOIN awards a ON a.quoteId = q1.id AND a.status = 'ACTIVE'
INNER JOIN users u1 ON a.supplierId = u1.id
INNER JOIN quote_items qi2 ON qi2.rfqItemId = ri.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.item_status = 'AWARDED'
GROUP BY ri.id, ri.productName, a.supplierId, u1.username, qi1.price, a.id
HAVING qi1.price > MIN(qi2.price)
ORDER BY ri.productName;

-- 4. 建议的修复方案
SELECT '=== 修复建议 ===' AS section;
SELECT 
    '方案1：通过 API 重新触发自动评标' AS suggestion,
    CONCAT('POST /api/rfqs/', @rfq_id, '/evaluate') AS api_endpoint,
    '这将重新评标所有商品，选择最低报价' AS description
UNION ALL
SELECT 
    '方案2：手动取消错误的 Award，然后重新评标' AS suggestion,
    '需要先取消错误的 Award 记录' AS api_endpoint,
    '然后通过 API 重新触发自动评标' AS description;

