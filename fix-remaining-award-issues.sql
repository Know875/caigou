-- 修复剩余的中标逻辑问题

USE caigou;

-- ============================================
-- 问题1：RFQ-1764384516816 - MB 全刃+MR魂红高达
-- ============================================
-- 有2个 ACTIVE Award（赛罗、豪）
-- 根据一口价逻辑，应该选择最早提交的（赛罗：450.00，2025-11-29 03:00:55.311）
-- 需要取消豪的 Award

SELECT '=== 修复问题1：RFQ-1764384516816 - MB 全刃+MR魂红高达 ===' AS section;

-- 取消豪的 Award
UPDATE awards 
SET status = 'CANCELLED',
    cancellation_reason = 'AUTO_EVALUATE_REAWARD',
    cancelled_at = NOW(),
    cancelled_by = 'SYSTEM'
WHERE id = 'cmijt91h5002fkqz75p6jdbwu'
  AND status = 'ACTIVE';

SELECT CONCAT('已取消豪的 Award: ', ROW_COUNT(), ' 条记录') AS result;

-- 删除豪的 AwardItem
DELETE FROM award_items 
WHERE awardId = 'cmijt91h5002fkqz75p6jdbwu';

SELECT CONCAT('已删除豪的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- ============================================
-- 问题2.1：商品状态是 AWARDED，但没有 ACTIVE Award
-- ============================================
-- 需要检查这些商品的报价情况，确定是否应该中标

SELECT '=== 检查问题2.1商品的报价情况 ===' AS section;

-- RFQ-1764735881464: MGSD巴巴托斯, RG福冈牛, 阿克西斯大青椒
SELECT 
    'RFQ-1764735881464' AS rfq_no,
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
    a.status AS award_status
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users s ON q.supplierId = s.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764735881464' COLLATE utf8mb4_unicode_ci
  AND ri.id IN (
    'cmipi6gwf000okq9fe60aev1e', -- MGSD巴巴托斯
    'cmipi6gwf000mkq9fyp7yd9n6', -- RG福冈牛
    'cmipi6gwf000kkq9fskc2dg9z'  -- 阿克西斯大青椒
  )
ORDER BY ri.productName, 
    CASE WHEN ri.instant_price IS NOT NULL AND CAST(qi.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2)) THEN 0 ELSE 1 END,
    CAST(qi.price AS DECIMAL(10, 2)) ASC,
    q.submittedAt ASC;

-- RFQ-1764764222530: PG菲尼克斯NT
SELECT 
    'RFQ-1764764222530' AS rfq_no,
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
    a.status AS award_status
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users s ON q.supplierId = s.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764764222530' COLLATE utf8mb4_unicode_ci
  AND ri.id = 'cmipz1x170007kqdsvjcy2zre' -- PG菲尼克斯NT
ORDER BY 
    CASE WHEN ri.instant_price IS NOT NULL AND CAST(qi.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2)) THEN 0 ELSE 1 END,
    CAST(qi.price AS DECIMAL(10, 2)) ASC,
    q.submittedAt ASC;

-- RFQ-1764835229244: MG完美独角兽基地限定, SHF铠武真骨雕
SELECT 
    'RFQ-1764835229244' AS rfq_no,
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
    a.status AS award_status
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users s ON q.supplierId = s.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764835229244' COLLATE utf8mb4_unicode_ci
  AND ri.id IN (
    'cmir5bu50000hkq5hzd6v5r6k', -- MG完美独角兽基地限定
    'cmir5bu50000gkq5hviel1hky'  -- SHF铠武真骨雕
  )
ORDER BY ri.productName,
    CASE WHEN ri.instant_price IS NOT NULL AND CAST(qi.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2)) THEN 0 ELSE 1 END,
    CAST(qi.price AS DECIMAL(10, 2)) ASC,
    q.submittedAt ASC;

-- ============================================
-- 验证修复结果
-- ============================================
SELECT '=== 验证修复结果 ===' AS section;

-- 检查问题1是否已修复
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

-- 检查问题2.1是否还存在
SELECT 
    '问题2.1检查' AS check_type,
    ri.id AS rfq_item_id,
    ri.productName,
    r.rfqNo
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
WHERE ri.item_status = 'AWARDED'
  AND NOT EXISTS (
    SELECT 1 
    FROM awards a
    INNER JOIN award_items ai ON ai.awardId = a.id AND ai.rfqItemId = ri.id
    WHERE a.rfqId = ri.rfqId
      AND a.status = 'ACTIVE'
  )
ORDER BY r.rfqNo, ri.productName;

