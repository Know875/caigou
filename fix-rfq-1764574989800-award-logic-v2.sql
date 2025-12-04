-- 修复 RFQ-1764574989800 的中标逻辑（版本2）
-- 问题：虽然更新了豪的 Award finalPrice，但 Award 仍然通过 quote_items 关联到所有商品
-- 解决方案：取消豪的整个 Award，然后为豪创建一个新的 Award（只包含 SHF巧爷基础2.0）

SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci);
SET @sailuo_id = (SELECT id FROM users WHERE username = '赛罗' COLLATE utf8mb4_unicode_ci);
SET @hao_id = (SELECT id FROM users WHERE username = '豪' COLLATE utf8mb4_unicode_ci);

SET autocommit = 0;
START TRANSACTION;

SELECT '=== 开始修复：取消豪的整个 Award，然后创建新的 Award（只包含 SHF巧爷基础2.0） ===' AS section;

-- 1. 查找豪的 Quote ID（包含 SHF巧爷基础2.0）
SET @hao_quote_id = (
    SELECT q.id 
    FROM quotes q
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE q.rfqId = @rfq_id
      AND q.supplierId = @hao_id
      AND ri.productName = 'SHF巧爷基础2.0' COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

SELECT CONCAT('豪的 Quote ID: ', @hao_quote_id) AS info;

-- 2. 取消豪的现有 Award
SELECT '=== 取消豪的现有 Award ===' AS section;

UPDATE awards
SET status = 'CANCELLED',
    cancellation_reason = 'MANUAL_REAWARD',
    cancelled_at = NOW(),
    reason = CONCAT(COALESCE(reason, ''), '；已取消：7个模玩兽100元福袋（可叠加）应由赛罗中标（满足一口价且最早提交）')
WHERE rfqId = @rfq_id
  AND supplierId = @hao_id
  AND status = 'ACTIVE';

-- 3. 为豪创建新的 Award（只包含 SHF巧爷基础2.0）
SELECT '=== 为豪创建新的 Award（只包含 SHF巧爷基础2.0） ===' AS section;

-- 计算 SHF巧爷基础2.0 的价格
SET @hao_shf_price = (
    SELECT qi.price
    FROM quote_items qi
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE qi.quoteId = @hao_quote_id
      AND ri.productName = 'SHF巧爷基础2.0' COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

SELECT CONCAT('SHF巧爷基础2.0 的价格: ', @hao_shf_price) AS info;

-- 创建新的 Award
INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt)
VALUES (
    CONCAT('cmip', SUBSTRING(MD5(CONCAT(@rfq_id, @hao_id, NOW(), 'v2')), 1, 21)),
    @rfq_id,
    @hao_quote_id,
    @hao_id,
    @hao_shf_price * 1,  -- 假设数量为1
    '手动修复：只包含 SHF巧爷基础2.0；已移除：7个模玩兽100元福袋（可叠加）应由赛罗中标（满足一口价且最早提交）',
    'ACTIVE',
    NOW(),
    NOW()
);

-- 4. 确保赛罗有正确的 Award（如果还没有，创建）
SELECT '=== 确保赛罗有正确的 Award ===' AS section;

SET @sailuo_quote_id = (
    SELECT q.id 
    FROM quotes q
    WHERE q.rfqId = @rfq_id
      AND q.supplierId = @sailuo_id
    ORDER BY q.submittedAt ASC
    LIMIT 1
);

-- 如果赛罗还没有 Award，创建一个
INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt)
SELECT 
    CONCAT('cmip', SUBSTRING(MD5(CONCAT(@rfq_id, @sailuo_id, NOW(), 'v2')), 1, 21)) AS id,
    @rfq_id AS rfqId,
    @sailuo_quote_id AS quoteId,
    @sailuo_id AS supplierId,
    (SELECT SUM(qi.price * COALESCE(ri.quantity, 1))
     FROM quote_items qi
     INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
     WHERE qi.quoteId = @sailuo_quote_id
       AND ri.productName = '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci) AS finalPrice,
    '一口价自动中标：模玩兽100元福袋（可叠加）（报价¥86 <= 一口价¥86），共 7 个商品' AS reason,
    'ACTIVE' AS status,
    NOW() AS createdAt,
    NOW() AS updatedAt
WHERE NOT EXISTS (
    SELECT 1 FROM awards a2
    WHERE a2.rfqId = @rfq_id
      AND a2.supplierId = @sailuo_id
      AND a2.status = 'ACTIVE'
);

-- 如果赛罗已有 Award，更新 finalPrice 和 reason
UPDATE awards a
INNER JOIN (
    SELECT 
        SUM(qi.price * COALESCE(ri.quantity, 1)) AS total_price,
        COUNT(DISTINCT qi.rfqItemId) AS item_count
    FROM quote_items qi
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE qi.quoteId = @sailuo_quote_id
      AND ri.productName = '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci
) AS calc
SET a.finalPrice = calc.total_price,
    a.reason = CONCAT('一口价自动中标：模玩兽100元福袋（可叠加）（报价¥86 <= 一口价¥86），共 ', calc.item_count, ' 个商品'),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.supplierId = @sailuo_id
  AND a.status = 'ACTIVE';

-- 验证修复结果
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

-- 检查豪的新 Award 是否只包含 SHF巧爷基础2.0
SELECT '=== 检查豪的新 Award 包含的商品 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    ri.productName,
    qi.price
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = @rfq_id
  AND a.supplierId = @hao_id
  AND a.status = 'ACTIVE'
ORDER BY ri.productName;

COMMIT;

SELECT '=== 修复完成 ===' AS section;

