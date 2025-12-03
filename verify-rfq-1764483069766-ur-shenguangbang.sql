-- 验证 RFQ-1764483069766 中 UR神光棒 的转移结果

SET @rfq_no = 'RFQ-1764483069766';
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);

-- 1. 查看 UR神光棒 的当前状态
SELECT '=== UR神光棒 的当前状态 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    u.username AS supplier_name,
    qi.price,
    a.status AS award_status,
    a.finalPrice AS award_total_price
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
INNER JOIN users u ON q.supplierId = u.id
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%UR神光棒%'
ORDER BY qi.price ASC
LIMIT 1;

-- 2. 查看赛罗的 Award（应该只包含 SHF歌查德）
SELECT '=== 赛罗的 Award ===' AS section;
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
  AND u.username COLLATE utf8mb4_unicode_ci = '赛罗' COLLATE utf8mb4_unicode_ci
  AND a.status != 'CANCELLED'
GROUP BY a.id, u.username, a.status, a.finalPrice;

-- 3. 查看豪的 Award（应该包含 MG艾比安 和 UR神光棒）
SELECT '=== 豪的 Award ===' AS section;
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
  AND u.username COLLATE utf8mb4_unicode_ci = '豪' COLLATE utf8mb4_unicode_ci
  AND a.status != 'CANCELLED'
GROUP BY a.id, u.username, a.status, a.finalPrice;

-- 4. 查看豪对 UR神光棒 的报价项
SELECT '=== 豪对 UR神光棒 的报价项 ===' AS section;
SELECT 
    qi.id AS quote_item_id,
    q.id AS quote_id,
    u.username AS supplier_name,
    qi.price,
    ri.productName
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%UR神光棒%'
  AND u.username COLLATE utf8mb4_unicode_ci = '豪' COLLATE utf8mb4_unicode_ci;

