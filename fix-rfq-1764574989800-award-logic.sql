-- 修复 RFQ-1764574989800 的中标逻辑
-- 问题：7个"模玩兽100元福袋（可叠加）"都有2个 ACTIVE Award（豪和赛罗）
-- 应该中标：赛罗（满足一口价86.00且最早提交）

SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci);
SET @sailuo_id = (SELECT id FROM users WHERE username = '赛罗' COLLATE utf8mb4_unicode_ci);
SET @hao_id = (SELECT id FROM users WHERE username = '豪' COLLATE utf8mb4_unicode_ci);

SET autocommit = 0;
START TRANSACTION;

SELECT '=== 开始修复：取消豪对7个"模玩兽100元福袋（可叠加）"的 Award ===' AS section;

-- 查找所有"模玩兽100元福袋（可叠加）"商品的 ID
SELECT '=== 所有"模玩兽100元福袋（可叠加）"商品 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') AS suppliers
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN awards a ON q.id = a.quoteId
INNER JOIN users u ON a.supplierId = u.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND ri.productName = '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci
  AND a.status = 'ACTIVE'
GROUP BY ri.id, ri.productName, ri.item_status, ri.instant_price;

-- 取消豪对7个"模玩兽100元福袋（可叠加）"的 Award
-- 方法：更新豪的 Award，移除这些商品的 quote_items 关联
-- 但更简单的方法是：直接取消豪的 Award 中包含这些商品的 Award 记录
-- 但 Award 记录是基于 quoteId 的，不能只取消部分商品

-- 方案：取消豪的 Award（如果它只包含这些商品），或者更新 finalPrice 和 reason
-- 由于 Award 是基于整个 Quote 的，我们需要检查豪的 Award 是否还包含其他商品

SELECT '=== 检查豪的 Award 包含的商品 ===' AS section;

SELECT 
    a.id AS award_id,
    a.status,
    a.finalPrice,
    a.reason,
    COUNT(DISTINCT qi.rfqItemId) AS item_count,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND a.supplierId = @hao_id
  AND a.status = 'ACTIVE'
GROUP BY a.id, a.status, a.finalPrice, a.reason;

-- 如果豪的 Award 还包含 SHF巧爷基础2.0，我们需要保留 Award，但更新 finalPrice
-- 如果豪的 Award 只包含"模玩兽100元福袋（可叠加）"，我们可以取消整个 Award

-- 先检查豪的 Award 是否包含其他商品
SET @hao_award_has_other_items = (
    SELECT COUNT(DISTINCT qi.rfqItemId)
    FROM awards a
    INNER JOIN quotes q ON a.quoteId = q.id
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE a.rfqId = @rfq_id
      AND a.supplierId = @hao_id
      AND a.status = 'ACTIVE'
      AND ri.productName != '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci
);

SELECT CONCAT('豪的 Award 包含其他商品数量: ', @hao_award_has_other_items) AS info;

-- 如果豪的 Award 包含其他商品（SHF巧爷基础2.0），我们需要：
-- 1. 更新豪的 Award finalPrice（移除7个福袋的价格）
-- 2. 更新 reason
-- 3. 取消豪对7个福袋的 Award（通过取消 Award 中包含这些商品的 quote_items 关联？）
-- 但实际上，Award 是基于整个 Quote 的，我们不能只取消部分商品

-- 更好的方案：由于 Award 是基于整个 Quote 的，我们需要：
-- 1. 如果豪的 Award 只包含福袋，取消整个 Award
-- 2. 如果豪的 Award 还包含其他商品，我们需要创建一个新的 Award 只包含其他商品
--    但这很复杂，因为需要创建新的 Quote

-- 最简单的方案：直接取消豪的 Award，然后为 SHF巧爷基础2.0 创建一个新的 Award
-- 但这样会丢失历史记录

-- 实际方案：由于赛罗已经发货，我们应该：
-- 1. 取消豪对7个福袋的 Award（通过取消豪的 Award 中包含这些商品的关联）
-- 2. 但 Award 是基于 Quote 的，我们不能这样做

-- 最终方案：由于数据结构限制，我们只能：
-- 1. 取消豪的整个 Award（如果它只包含福袋）
-- 2. 或者更新豪的 Award finalPrice 和 reason，说明这些商品已移除
-- 3. 但 Award 记录本身仍然存在，只是 finalPrice 会减少

-- 检查豪的 Award 是否只包含福袋
SET @hao_award_only_fudai = (
    SELECT COUNT(DISTINCT qi.rfqItemId)
    FROM awards a
    INNER JOIN quotes q ON a.quoteId = q.id
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE a.rfqId = @rfq_id
      AND a.supplierId = @hao_id
      AND a.status = 'ACTIVE'
      AND ri.productName = '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci
);

SET @hao_award_total_items = (
    SELECT COUNT(DISTINCT qi.rfqItemId)
    FROM awards a
    INNER JOIN quotes q ON a.quoteId = q.id
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    WHERE a.rfqId = @rfq_id
      AND a.supplierId = @hao_id
      AND a.status = 'ACTIVE'
);

SELECT CONCAT('豪的 Award 只包含福袋: ', IF(@hao_award_only_fudai = @hao_award_total_items, '是', '否')) AS info;

-- 如果豪的 Award 只包含福袋，取消整个 Award
-- 如果豪的 Award 还包含其他商品，更新 finalPrice 和 reason

-- MySQL 5.7 不支持 IF 语句，使用 CASE WHEN 或分别执行

-- 先更新豪的 Award finalPrice（移除7个福袋的价格）
UPDATE awards a
INNER JOIN (
    SELECT 
        a2.id AS award_id,
        SUM(qi.price * COALESCE(ri.quantity, 1)) AS total_price,
        COUNT(DISTINCT qi.rfqItemId) AS item_count
    FROM awards a2
    INNER JOIN quotes q ON a2.quoteId = q.id
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE a2.rfqId = @rfq_id
      AND a2.supplierId = @hao_id
      AND a2.status = 'ACTIVE'
      AND ri.productName != '模玩兽100元福袋（可叠加）' COLLATE utf8mb4_unicode_ci
    GROUP BY a2.id
) AS calc ON a.id = calc.award_id
SET a.finalPrice = calc.total_price,
    a.reason = CONCAT('按商品级别选商，共 ', calc.item_count, ' 个商品；已移除：7个模玩兽100元福袋（可叠加）应由赛罗中标（满足一口价且最早提交）'),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.supplierId = @hao_id
  AND a.status = 'ACTIVE';

-- 如果更新后 finalPrice 为 0 或 NULL，说明只包含福袋，取消 Award
UPDATE awards
SET status = 'CANCELLED',
    cancellation_reason = 'MANUAL_REAWARD',
    cancelled_at = NOW(),
    reason = CONCAT(COALESCE(reason, ''), '；已移除：7个模玩兽100元福袋（可叠加）应由赛罗中标（满足一口价且最早提交）')
WHERE rfqId = @rfq_id
  AND supplierId = @hao_id
  AND status = 'ACTIVE'
  AND (finalPrice IS NULL OR finalPrice = 0);

-- 确保赛罗有正确的 Award
SELECT '=== 确保赛罗有正确的 Award ===' AS section;

-- 查找赛罗的 Quote ID
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
    CONCAT('cmip', SUBSTRING(MD5(CONCAT(@rfq_id, @sailuo_id, NOW())), 1, 21)) AS id,
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

COMMIT;

SELECT '=== 修复完成 ===' AS section;

