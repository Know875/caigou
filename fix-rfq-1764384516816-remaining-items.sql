-- 修复 RFQ-1764384516816 的剩余商品：MB正义 和 RG福冈牛

USE caigou;

SELECT '=== 检查 RFQ-1764384516816 的完整情况 ===' AS section;

-- 检查该询价单的所有商品和报价情况
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    s.username AS supplier_name,
    q.id AS quote_id,
    q.status AS quote_status,
    q.submittedAt,
    qi.price AS quote_item_price,
    CASE 
        WHEN ri.instant_price IS NOT NULL AND CAST(qi.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2)) THEN '满足一口价'
        ELSE '不满足一口价'
    END AS instant_price_status,
    a.id AS award_id,
    a.status AS award_status,
    a.cancellation_reason
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users s ON q.supplierId = s.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764384516816' COLLATE utf8mb4_unicode_ci
ORDER BY ri.productName,
    CASE WHEN ri.instant_price IS NOT NULL AND CAST(qi.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2)) THEN 0 ELSE 1 END,
    CAST(qi.price AS DECIMAL(10, 2)) ASC,
    q.submittedAt ASC;

SELECT '=== 修复 MB正义 和 RG福冈牛 ===' AS section;

-- 检查 Award cmijt91h5002fkqz75p6jdbwu 的完整情况
SELECT 
    'Award 详情' AS info_type,
    a.id AS award_id,
    a.rfqId,
    a.quoteId,
    a.status AS award_status,
    a.finalPrice,
    a.cancellation_reason,
    a.cancelled_at,
    s.username AS supplier_name,
    COUNT(ai.id) AS award_item_count
FROM awards a
INNER JOIN quotes q ON q.id = a.quoteId
INNER JOIN users s ON s.id = q.supplierId
LEFT JOIN award_items ai ON ai.awardId = a.id
WHERE a.id = 'cmijt91h5002fkqz75p6jdbwu'
GROUP BY a.id, a.rfqId, a.quoteId, a.status, a.finalPrice, a.cancellation_reason, a.cancelled_at, s.username;

-- 检查该 Award 应该包含哪些商品
SELECT 
    '应该包含的商品' AS info_type,
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    qi.id AS quote_item_id,
    qi.price AS quote_item_price,
    CASE 
        WHEN ai.id IS NOT NULL THEN '已有 AwardItem'
        ELSE '缺少 AwardItem'
    END AS award_item_status
FROM awards a
INNER JOIN quotes q ON q.id = a.quoteId
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON ri.id = qi.rfqItemId
LEFT JOIN award_items ai ON ai.awardId = a.id AND ai.rfqItemId = ri.id
WHERE a.id = 'cmijt91h5002fkqz75p6jdbwu'
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;

-- 恢复 Award（如果它应该包含 MB正义 和 RG福冈牛）
-- 注意：这个 Award 之前被取消了，可能是因为修复 MB 全刃+MR魂红高达 时取消的
-- 但 MB正义 和 RG福冈牛 仍然应该是中标的，所以需要恢复这个 Award

UPDATE awards 
SET status = 'ACTIVE',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL
WHERE id = 'cmijt91h5002fkqz75p6jdbwu'
  AND status = 'CANCELLED';

SELECT CONCAT('已恢复豪的 Award: ', ROW_COUNT(), ' 条记录') AS result;

-- 创建/恢复 AwardItem for MB正义
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmijt91h5002fkqz75p6jdbwu' AS awardId,
    'cmijozi9x0002kqz7kpbuluhr' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmijozi9x0002kqz7kpbuluhr' -- MB正义
  AND q.id = 'cmijrbi2k0020kqz70g0pggw1'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmijt91h5002fkqz75p6jdbwu' 
      AND ai.rfqItemId = 'cmijozi9x0002kqz7kpbuluhr'
  );

SELECT CONCAT('已创建 MB正义 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 创建/恢复 AwardItem for RG福冈牛
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmijt91h5002fkqz75p6jdbwu' AS awardId,
    'cmijozi9x0004kqz7tu69jnms' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmijozi9x0004kqz7tu69jnms' -- RG福冈牛
  AND q.id = 'cmijrbi2k0020kqz70g0pggw1'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmijt91h5002fkqz75p6jdbwu' 
      AND ai.rfqItemId = 'cmijozi9x0004kqz7tu69jnms'
  );

SELECT CONCAT('已创建 RG福冈牛 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 更新 Award 的 finalPrice
UPDATE awards a
SET finalPrice = (
    SELECT SUM(ai.price * ai.quantity)
    FROM award_items ai
    WHERE ai.awardId = a.id
)
WHERE a.id = 'cmijt91h5002fkqz75p6jdbwu';

SELECT CONCAT('已更新豪的 Award finalPrice') AS result;

-- ============================================
-- 验证修复结果
-- ============================================

SELECT '=== 验证修复结果 ===' AS section;

-- 检查问题2.1是否已完全修复
SELECT 
    '问题2.1检查' AS check_type,
    COUNT(*) AS issue_count
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
WHERE ri.item_status = 'AWARDED'
  AND NOT EXISTS (
    SELECT 1 
    FROM awards a
    INNER JOIN award_items ai ON ai.awardId = a.id AND ai.rfqItemId = ri.id
    WHERE a.rfqId = ri.rfqId
      AND a.status = 'ACTIVE'
  );

-- 显示所有已修复的商品
SELECT 
    '已修复的商品' AS summary,
    r.rfqNo,
    ri.productName,
    s.username AS supplier_name,
    a.id AS award_id,
    a.status AS award_status,
    a.finalPrice
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
INNER JOIN award_items ai ON ai.rfqItemId = ri.id
INNER JOIN awards a ON a.id = ai.awardId
INNER JOIN quotes q ON q.id = a.quoteId
INNER JOIN users s ON s.id = q.supplierId
WHERE ri.id IN (
    'cmijozi9x0002kqz7kpbuluhr', -- MB正义
    'cmijozi9x0004kqz7tu69jnms'  -- RG福冈牛
)
  AND a.status = 'ACTIVE'
ORDER BY r.rfqNo, ri.productName;

-- 最终验证：运行完整的检查脚本
SELECT '=== 最终验证：运行完整检查 ===' AS section;

-- 检查问题1（同一商品多个 ACTIVE Award）
SELECT 
    '问题1检查' AS check_type,
    COUNT(*) AS issue_count
FROM (
    SELECT 
        ri.id,
        COUNT(DISTINCT a.id) AS active_award_count
    FROM rfq_items ri
    INNER JOIN awards a ON a.rfqId = ri.rfqId
    INNER JOIN award_items ai ON ai.awardId = a.id AND ai.rfqItemId = ri.id
    WHERE a.status = 'ACTIVE'
      AND ri.item_status = 'AWARDED'
    GROUP BY ri.id
    HAVING COUNT(DISTINCT a.id) > 1
) AS duplicates;

-- 检查问题2.1（商品状态是 AWARDED，但没有 ACTIVE Award）
SELECT 
    '问题2.1检查' AS check_type,
    COUNT(*) AS issue_count
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
WHERE ri.item_status = 'AWARDED'
  AND NOT EXISTS (
    SELECT 1 
    FROM awards a
    INNER JOIN award_items ai ON ai.awardId = a.id AND ai.rfqItemId = ri.id
    WHERE a.rfqId = ri.rfqId
      AND a.status = 'ACTIVE'
  );

-- 检查问题3.2（AwardItem 对应的 Award 状态不是 ACTIVE）
SELECT 
    '问题3.2检查' AS check_type,
    COUNT(*) AS issue_count
FROM award_items ai
INNER JOIN awards a ON a.id = ai.awardId
WHERE a.status != 'ACTIVE';

