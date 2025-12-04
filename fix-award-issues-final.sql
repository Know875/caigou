-- 最终修复中标逻辑问题
-- 恢复被错误取消的 Award

USE caigou;

-- ============================================
-- RFQ-1764735881464: MGSD巴巴托斯, RG福冈牛, 阿克西斯大青椒
-- ============================================

SELECT '=== 修复 RFQ-1764735881464 ===' AS section;

-- 1. MGSD巴巴托斯 (cmipi6gwf000okq9fe60aev1e)
-- 豪报价205.00（最低价，不满足一口价200.00），应该恢复豪的Award
-- Award ID: cmipl1njd0063kq9f0g4p9uc8

-- 恢复豪的 Award（如果还没有恢复）
UPDATE awards 
SET status = 'ACTIVE',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL
WHERE id = 'cmipl1njd0063kq9f0g4p9uc8'
  AND status = 'CANCELLED';

SELECT CONCAT('已恢复 MGSD巴巴托斯 的 Award: ', ROW_COUNT(), ' 条记录') AS result;

-- 创建/恢复 AwardItem for MGSD巴巴托斯
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmipl1njd0063kq9f0g4p9uc8' AS awardId,
    'cmipi6gwf000okq9fe60aev1e' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmipi6gwf000okq9fe60aev1e'
  AND q.id = 'cmipl1ng0005rkq9fq92aimv2'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmipl1njd0063kq9f0g4p9uc8' 
      AND ai.rfqItemId = 'cmipi6gwf000okq9fe60aev1e'
  );

SELECT CONCAT('已创建 MGSD巴巴托斯 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 2. RG福冈牛 (cmipi6gwf000mkq9fyp7yd9n6)
-- 胡先生报价330.00（不满足一口价320.00），应该恢复胡先生的Award
-- Award ID: cmipmfwkm0001kquni75dziln

-- 恢复胡先生的 Award
UPDATE awards 
SET status = 'ACTIVE',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL
WHERE id = 'cmipmfwkm0001kquni75dziln'
  AND status = 'CANCELLED';

SELECT CONCAT('已恢复 RG福冈牛 的 Award: ', ROW_COUNT(), ' 条记录') AS result;

-- 创建/恢复 AwardItem for RG福冈牛
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmipmfwkm0001kquni75dziln' AS awardId,
    'cmipi6gwf000mkq9fyp7yd9n6' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmipi6gwf000mkq9fyp7yd9n6'
  AND q.id = 'cmipir8km004ukq9fgz22p5rd'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmipmfwkm0001kquni75dziln' 
      AND ai.rfqItemId = 'cmipi6gwf000mkq9fyp7yd9n6'
  );

SELECT CONCAT('已创建 RG福冈牛 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 3. 阿克西斯大青椒 (cmipi6gwf000kkq9fskc2dg9z)
-- 豪报价510.00（满足一口价510.00），应该恢复豪的Award
-- Award ID: cmipl1njd0063kq9f0g4p9uc8（与MGSD巴巴托斯是同一个Award）

-- 创建/恢复 AwardItem for 阿克西斯大青椒（如果还没有）
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmipl1njd0063kq9f0g4p9uc8' AS awardId,
    'cmipi6gwf000kkq9fskc2dg9z' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmipi6gwf000kkq9fskc2dg9z'
  AND q.id = 'cmipl1ng0005rkq9fq92aimv2'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmipl1njd0063kq9f0g4p9uc8' 
      AND ai.rfqItemId = 'cmipi6gwf000kkq9fskc2dg9z'
  );

SELECT CONCAT('已创建 阿克西斯大青椒 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 更新豪的 Award 的 finalPrice（包含MGSD巴巴托斯和阿克西斯大青椒）
UPDATE awards a
SET finalPrice = (
    SELECT SUM(ai.price * ai.quantity)
    FROM award_items ai
    WHERE ai.awardId = a.id
)
WHERE a.id = 'cmipl1njd0063kq9f0g4p9uc8';

SELECT CONCAT('已更新豪的 Award finalPrice') AS result;

-- ============================================
-- RFQ-1764764222530: PG菲尼克斯NT
-- ============================================

SELECT '=== 修复 RFQ-1764764222530 ===' AS section;

-- PG菲尼克斯NT (cmipz1x170007kqdsvjcy2zre)
-- 豪报价3200.00（不满足一口价3180.00），应该恢复豪的Award
-- Award ID: cmiq0mzyf0038kqdseygv9zb5

-- 恢复豪的 Award
UPDATE awards 
SET status = 'ACTIVE',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL
WHERE id = 'cmiq0mzyf0038kqdseygv9zb5'
  AND status = 'CANCELLED';

SELECT CONCAT('已恢复 PG菲尼克斯NT 的 Award: ', ROW_COUNT(), ' 条记录') AS result;

-- 创建/恢复 AwardItem for PG菲尼克斯NT
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmiq0mzyf0038kqdseygv9zb5' AS awardId,
    'cmipz1x170007kqdsvjcy2zre' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmipz1x170007kqdsvjcy2zre'
  AND q.id = 'cmiq0mzw40030kqdswqelidh1'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmiq0mzyf0038kqdseygv9zb5' 
      AND ai.rfqItemId = 'cmipz1x170007kqdsvjcy2zre'
  );

SELECT CONCAT('已创建 PG菲尼克斯NT 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 更新豪的 Award 的 finalPrice
UPDATE awards a
SET finalPrice = (
    SELECT SUM(ai.price * ai.quantity)
    FROM award_items ai
    WHERE ai.awardId = a.id
)
WHERE a.id = 'cmiq0mzyf0038kqdseygv9zb5';

SELECT CONCAT('已更新豪的 Award finalPrice') AS result;

-- ============================================
-- RFQ-1764835229244: MG完美独角兽基地限定, SHF铠武真骨雕
-- ============================================

SELECT '=== 修复 RFQ-1764835229244 ===' AS section;

-- 1. MG完美独角兽基地限定 (cmir5bu50000hkq5hzd6v5r6k)
-- 豪报价855.00（不满足一口价850.00），应该恢复豪的Award
-- Award ID: cmir5kgdx0016kqoa6wzfc2i6

-- 2. SHF铠武真骨雕 (cmir5bu50000gkq5hviel1hky)
-- 豪报价538.00（满足一口价538.00），应该恢复豪的Award
-- Award ID: cmir5kgdx0016kqoa6wzfc2i6（与MG完美独角兽基地限定是同一个Award）

-- 恢复豪的 Award
UPDATE awards 
SET status = 'ACTIVE',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    cancelled_by = NULL
WHERE id = 'cmir5kgdx0016kqoa6wzfc2i6'
  AND status = 'CANCELLED';

SELECT CONCAT('已恢复豪的 Award: ', ROW_COUNT(), ' 条记录') AS result;

-- 创建/恢复 AwardItem for MG完美独角兽基地限定
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmir5kgdx0016kqoa6wzfc2i6' AS awardId,
    'cmir5bu50000hkq5hzd6v5r6k' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmir5bu50000hkq5hzd6v5r6k'
  AND q.id = 'cmir5kgbq000xkqoa1c4tp3x9'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmir5kgdx0016kqoa6wzfc2i6' 
      AND ai.rfqItemId = 'cmir5bu50000hkq5hzd6v5r6k'
  );

SELECT CONCAT('已创建 MG完美独角兽基地限定 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 创建/恢复 AwardItem for SHF铠武真骨雕
INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', UUID_SHORT()) AS id,
    'cmir5kgdx0016kqoa6wzfc2i6' AS awardId,
    'cmir5bu50000gkq5hviel1hky' AS rfqItemId,
    qi.id AS quoteItemId,
    qi.price,
    ri.quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON q.id = qi.quoteId
WHERE ri.id = 'cmir5bu50000gkq5hviel1hky'
  AND q.id = 'cmir5kgbq000xkqoa1c4tp3x9'
  AND NOT EXISTS (
    SELECT 1 FROM award_items ai 
    WHERE ai.awardId = 'cmir5kgdx0016kqoa6wzfc2i6' 
      AND ai.rfqItemId = 'cmir5bu50000gkq5hviel1hky'
  );

SELECT CONCAT('已创建 SHF铠武真骨雕 的 AwardItem: ', ROW_COUNT(), ' 条记录') AS result;

-- 更新豪的 Award 的 finalPrice（包含MG完美独角兽基地限定和SHF铠武真骨雕）
UPDATE awards a
SET finalPrice = (
    SELECT SUM(ai.price * ai.quantity)
    FROM award_items ai
    WHERE ai.awardId = a.id
)
WHERE a.id = 'cmir5kgdx0016kqoa6wzfc2i6';

SELECT CONCAT('已更新豪的 Award finalPrice') AS result;

-- ============================================
-- RFQ-1764384516816: MB正义, RG福冈牛
-- ============================================

SELECT '=== 检查 RFQ-1764384516816 的其他商品 ===' AS section;

-- 检查 MB正义 和 RG福冈牛 的报价情况
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
    a.status AS award_status
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfqId
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users s ON q.supplierId = s.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo = 'RFQ-1764384516816' COLLATE utf8mb4_unicode_ci
  AND ri.id IN (
    'cmijozi9x0002kqz7kpbuluhr', -- MB正义
    'cmijozi9x0004kqz7tu69jnms'  -- RG福冈牛
  )
ORDER BY ri.productName,
    CASE WHEN ri.instant_price IS NOT NULL AND CAST(qi.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2)) THEN 0 ELSE 1 END,
    CAST(qi.price AS DECIMAL(10, 2)) ASC,
    q.submittedAt ASC;

-- ============================================
-- 验证修复结果
-- ============================================

SELECT '=== 验证修复结果 ===' AS section;

-- 检查问题2.1是否已修复
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
    'cmipi6gwf000okq9fe60aev1e', -- MGSD巴巴托斯
    'cmipi6gwf000mkq9fyp7yd9n6', -- RG福冈牛
    'cmipi6gwf000kkq9fskc2dg9z', -- 阿克西斯大青椒
    'cmipz1x170007kqdsvjcy2zre', -- PG菲尼克斯NT
    'cmir5bu50000hkq5hzd6v5r6k', -- MG完美独角兽基地限定
    'cmir5bu50000gkq5hviel1hky'  -- SHF铠武真骨雕
)
  AND a.status = 'ACTIVE'
ORDER BY r.rfqNo, ri.productName;

