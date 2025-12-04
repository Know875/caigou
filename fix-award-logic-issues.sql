-- 修复中标逻辑问题
-- 根据检查脚本发现的问题进行修复

USE caigou;

-- ============================================
-- 问题1：同一商品有多个 ACTIVE Award
-- ============================================
-- RFQ-1764384516816: MB 全刃+MR魂红高达 (cmijozi9x0006kqz7cvshxzkg)
-- 有2个 ACTIVE Award（豪、赛罗）
-- 需要确定正确的中标供应商并取消其他 Award

-- 先检查该商品的报价情况
SELECT '=== 检查 RFQ-1764384516816: MB 全刃+MR魂红高达 的报价情况 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
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
WHERE r.rfqNo = 'RFQ-1764384516816' COLLATE utf8mb4_unicode_ci
  AND ri.productName = 'MB 全刃+MR魂红高达' COLLATE utf8mb4_unicode_ci
ORDER BY 
    CASE WHEN ri.instant_price IS NOT NULL AND CAST(qi.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2)) THEN 0 ELSE 1 END,
    CAST(qi.price AS DECIMAL(10, 2)) ASC,
    q.submittedAt ASC;

-- ============================================
-- 问题2.1：商品状态是 AWARDED，但没有 ACTIVE Award
-- ============================================
-- 这些商品需要：
-- 1. 如果有 CANCELLED Award，检查是否可以恢复
-- 2. 如果没有 Award，需要创建新的 Award
-- 3. 如果确实不应该中标，将商品状态改为 PENDING

-- RFQ-1764735881464: MGSD巴巴托斯, RG福冈牛, 阿克西斯大青椒
-- RFQ-1764764222530: PG菲尼克斯NT
-- RFQ-1764835229244: MG完美独角兽基地限定, SHF铠武真骨雕

-- 先检查这些商品的 Award 历史
SELECT '=== 检查问题商品的 Award 历史 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    r.rfqNo,
    ri.item_status,
    a.id AS award_id,
    a.status AS award_status,
    s.username AS supplier_name,
    a.cancellation_reason,
    a.cancelled_at
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
LEFT JOIN award_items ai ON ai.rfqItemId = ri.id
LEFT JOIN awards a ON a.id = ai.awardId
LEFT JOIN quotes q ON q.id = a.quoteId
LEFT JOIN users s ON s.id = q.supplierId
WHERE ri.id IN (
    'cmipi6gwf000okq9fe60aev1e', -- MGSD巴巴托斯
    'cmipi6gwf000mkq9fyp7yd9n6', -- RG福冈牛
    'cmipi6gwf000kkq9fskc2dg9z', -- 阿克西斯大青椒
    'cmipz1x170007kqdsvjcy2zre', -- PG菲尼克斯NT
    'cmir5bu50000hkq5hzd6v5r6k', -- MG完美独角兽基地限定
    'cmir5bu50000gkq5hviel1hky'  -- SHF铠武真骨雕
)
ORDER BY r.rfqNo, ri.productName, a.status;

-- ============================================
-- 问题3.2：AwardItem 对应的 Award 状态不是 ACTIVE
-- ============================================
-- RFQ-1764835229244: MG完美独角兽基地限定, SHF铠武真骨雕
-- AwardItem 对应的 Award 是 CANCELLED，应该删除这些 AwardItem

SELECT '=== 删除 CANCELLED Award 的 AwardItem ===' AS section;

-- 删除 CANCELLED Award 的 AwardItem
DELETE ai FROM award_items ai
INNER JOIN awards a ON a.id = ai.awardId
WHERE a.status = 'CANCELLED';

SELECT CONCAT('已删除 ', ROW_COUNT(), ' 个 CANCELLED Award 的 AwardItem') AS result;

-- ============================================
-- 验证修复结果
-- ============================================
SELECT '=== 验证修复结果 ===' AS section;

-- 检查是否还有问题1（同一商品多个 ACTIVE Award）
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

-- 检查是否还有问题2.1（商品状态是 AWARDED，但没有 ACTIVE Award）
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

-- 检查是否还有问题3.2（AwardItem 对应的 Award 状态不是 ACTIVE）
SELECT 
    '问题3.2检查' AS check_type,
    COUNT(*) AS issue_count
FROM award_items ai
INNER JOIN awards a ON a.id = ai.awardId
WHERE a.status != 'ACTIVE';

