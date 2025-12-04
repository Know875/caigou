-- 修复 RFQ-1764574989800：从豪的 Quote 中删除7个福袋的 quote_items
-- 这样豪的 Award 就不会再关联到这些商品了

SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci);
SET @hao_id = (SELECT id FROM users WHERE username = '豪' COLLATE utf8mb4_unicode_ci);
SET @hao_quote_id = (
    SELECT q.id 
    FROM quotes q
    WHERE q.rfqId = @rfq_id
      AND q.supplierId = @hao_id
    LIMIT 1
);

SET autocommit = 0;
START TRANSACTION;

SELECT '=== 开始修复：从豪的 Quote 中删除7个福袋的 quote_items ===' AS section;

-- 查找豪的 Quote 中包含的所有福袋 quote_items
SELECT '=== 豪的 Quote 中包含的福袋 quote_items ===' AS section;

SELECT 
    qi.id AS quote_item_id,
    ri.productName,
    qi.price
FROM quote_items qi
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.quoteId = @hao_quote_id
  AND ri.productName = '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci;

-- 删除豪的 Quote 中所有福袋的 quote_items
SELECT '=== 删除豪的 Quote 中所有福袋的 quote_items ===' AS section;

DELETE qi
FROM quote_items qi
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.quoteId = @hao_quote_id
  AND ri.productName = '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci;

SELECT CONCAT('已删除 ', ROW_COUNT(), ' 个福袋的 quote_items') AS result;

-- 重新计算豪的 Quote 的 price（只包含 SHF巧爷基础2.0）
SELECT '=== 重新计算豪的 Quote 的 price ===' AS section;

UPDATE quotes q
SET price = (
    SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
    FROM quote_items qi
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE qi.quoteId = q.id
),
updatedAt = NOW()
WHERE q.id = @hao_quote_id;

-- 验证修复结果
SELECT '=== 修复后的豪的 Quote 包含的商品 ===' AS section;

SELECT 
    qi.id AS quote_item_id,
    ri.productName,
    qi.price
FROM quote_items qi
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.quoteId = @hao_quote_id
ORDER BY ri.productName;

SELECT '=== 修复后的 Award 记录 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    COUNT(DISTINCT qi.rfqItemId) AS item_count,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
INNER JOIN rfqs r ON a.rfqId = r.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND a.status = 'ACTIVE'
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason
ORDER BY u.username;

SELECT '=== 检查是否还有重复的 Award ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') AS suppliers
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN awards a ON q.id = a.quoteId
INNER JOIN users u ON a.supplierId = u.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND a.status = 'ACTIVE'
  AND qi.rfqItemId = ri.id
GROUP BY ri.id, ri.productName
HAVING active_award_count > 1;

COMMIT;

SELECT '=== 修复完成 ===' AS section;

