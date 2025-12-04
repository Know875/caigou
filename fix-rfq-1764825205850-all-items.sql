-- 修复 RFQ-1764825205850 的所有问题商品
-- 1. 龙骑真骨雕：菜狗报价 ¥695.00 满足一口价 ¥695.00，恢复 Award
-- 2. MG暴风：菜狗报价 ¥205.00，不满足一口价但商品已中标，恢复 Award
-- 3. SHF灵骑：菜狗报价 ¥208.00，不满足一口价但商品已中标，恢复 Award

SET @rfq_no = 'RFQ-1764825205850' COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- 1. 获取 RFQ ID 和供应商 ID
SELECT '=== 获取基本信息 ===' AS section;

SET @rfq_id = (
    SELECT r.id 
    FROM rfqs r 
    WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
    LIMIT 1
);

SET @caigou_id = (SELECT id FROM users WHERE username = '菜狗' COLLATE utf8mb4_unicode_ci LIMIT 1);
SET @caigou_quote_id = (
    SELECT q.id 
    FROM quotes q 
    WHERE q.rfqId = @rfq_id 
      AND q.supplierId = @caigou_id
      AND q.status = 'AWARDED'
    LIMIT 1
);

-- 2. 恢复菜狗的 Award（如果存在 CANCELLED 状态）
SELECT '=== 恢复菜狗的 Award ===' AS section;

UPDATE awards
SET status = 'ACTIVE',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    updatedAt = NOW()
WHERE rfqId = @rfq_id 
  AND supplierId = @caigou_id
  AND status = 'CANCELLED'
  AND cancellation_reason = 'AUTO_EVALUATE_REAWARD'
LIMIT 1;

-- 获取 Award ID（可能是恢复的）
SET @caigou_award_id = (
    SELECT id 
    FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @caigou_id
      AND status = 'ACTIVE'
    LIMIT 1
);

-- 如果不存在 ACTIVE Award，创建新的
INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt)
SELECT 
    CONCAT('cmip', SUBSTRING(MD5(CONCAT(@rfq_id, @caigou_id, NOW(), 'fix-all')), 1, 21)) AS id,
    @rfq_id AS rfqId,
    @caigou_quote_id AS quoteId,
    @caigou_id AS supplierId,
    (
        SELECT SUM(qi.price * COALESCE(ri.quantity, 1))
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = @caigou_quote_id
          AND ri.item_status = 'AWARDED'
          AND ri.rfqId = @rfq_id
    ) AS finalPrice,
    '系统自动评标：按商品维度选择最低报价' AS reason,
    'ACTIVE' AS status,
    NOW() AS createdAt,
    NOW() AS updatedAt
WHERE NOT EXISTS (
    SELECT 1 FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @caigou_id
      AND status = 'ACTIVE'
);

-- 获取 Award ID（可能是恢复的，也可能是新创建的）
SET @caigou_award_id = (
    SELECT id 
    FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @caigou_id
      AND status = 'ACTIVE'
    LIMIT 1
);

-- 3. 为每个商品创建/恢复 AwardItem
SELECT '=== 创建/恢复 AwardItem ===' AS section;

-- 3.1 龙骑真骨雕（满足一口价）
SET @longqi_rfq_item_id = (
    SELECT ri.id 
    FROM rfq_items ri 
    WHERE ri.rfqId = @rfq_id 
      AND ri.productName = '龙骑真骨雕' COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

SET @longqi_quote_item_id = (
    SELECT qi.id 
    FROM quote_items qi 
    WHERE qi.quoteId = @caigou_quote_id 
      AND qi.rfqItemId = @longqi_rfq_item_id
    LIMIT 1
);

INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', SUBSTRING(MD5(CONCAT(@caigou_award_id, '_', @longqi_rfq_item_id)), 1, 20)) AS id,
    @caigou_award_id AS awardId,
    @longqi_rfq_item_id AS rfqItemId,
    @longqi_quote_item_id AS quoteItemId,
    (SELECT price FROM quote_items WHERE id = @longqi_quote_item_id) AS price,
    (SELECT COALESCE(quantity, 1) FROM rfq_items WHERE id = @longqi_rfq_item_id) AS quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
WHERE NOT EXISTS (
    SELECT 1 FROM award_items 
    WHERE awardId = @caigou_award_id 
      AND rfqItemId = @longqi_rfq_item_id
);

-- 3.2 MG暴风（不满足一口价，但商品已中标）
SET @baofeng_rfq_item_id = (
    SELECT ri.id 
    FROM rfq_items ri 
    WHERE ri.rfqId = @rfq_id 
      AND ri.productName = 'MG暴风' COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

SET @baofeng_quote_item_id = (
    SELECT qi.id 
    FROM quote_items qi 
    WHERE qi.quoteId = @caigou_quote_id 
      AND qi.rfqItemId = @baofeng_rfq_item_id
    LIMIT 1
);

INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', SUBSTRING(MD5(CONCAT(@caigou_award_id, '_', @baofeng_rfq_item_id)), 1, 20)) AS id,
    @caigou_award_id AS awardId,
    @baofeng_rfq_item_id AS rfqItemId,
    @baofeng_quote_item_id AS quoteItemId,
    (SELECT price FROM quote_items WHERE id = @baofeng_quote_item_id) AS price,
    (SELECT COALESCE(quantity, 1) FROM rfq_items WHERE id = @baofeng_rfq_item_id) AS quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
WHERE NOT EXISTS (
    SELECT 1 FROM award_items 
    WHERE awardId = @caigou_award_id 
      AND rfqItemId = @baofeng_rfq_item_id
);

-- 3.3 SHF灵骑（不满足一口价，但商品已中标）
SET @lingqi_rfq_item_id = (
    SELECT ri.id 
    FROM rfq_items ri 
    WHERE ri.rfqId = @rfq_id 
      AND ri.productName = 'SHF灵骑' COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

SET @lingqi_quote_item_id = (
    SELECT qi.id 
    FROM quote_items qi 
    WHERE qi.quoteId = @caigou_quote_id 
      AND qi.rfqItemId = @lingqi_rfq_item_id
    LIMIT 1
);

INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
SELECT 
    CONCAT('ai_', SUBSTRING(MD5(CONCAT(@caigou_award_id, '_', @lingqi_rfq_item_id)), 1, 20)) AS id,
    @caigou_award_id AS awardId,
    @lingqi_rfq_item_id AS rfqItemId,
    @lingqi_quote_item_id AS quoteItemId,
    (SELECT price FROM quote_items WHERE id = @lingqi_quote_item_id) AS price,
    (SELECT COALESCE(quantity, 1) FROM rfq_items WHERE id = @lingqi_rfq_item_id) AS quantity,
    NOW() AS createdAt,
    NOW() AS updatedAt
WHERE NOT EXISTS (
    SELECT 1 FROM award_items 
    WHERE awardId = @caigou_award_id 
      AND rfqItemId = @lingqi_rfq_item_id
);

-- 4. 更新 Award 的 finalPrice（包含所有中标的商品）
SELECT '=== 更新 Award finalPrice ===' AS section;

UPDATE awards a
SET finalPrice = (
    SELECT SUM(ai.price * ai.quantity)
    FROM award_items ai
    WHERE ai.awardId = a.id
),
updatedAt = NOW()
WHERE a.id = @caigou_award_id;

-- 5. 验证修复结果
SELECT '=== 验证修复结果 ===' AS section;

SELECT 
    ri.productName,
    ri.item_status,
    ri.instant_price,
    u.username AS supplier_name,
    a.status AS award_status,
    ai.price AS award_item_price,
    qi.price AS quote_item_price,
    CASE 
        WHEN ri.instant_price IS NOT NULL AND qi.price <= ri.instant_price THEN '满足一口价'
        WHEN ri.instant_price IS NOT NULL AND qi.price > ri.instant_price THEN '不满足一口价'
        ELSE '无一口价'
    END AS instant_price_status
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN award_items ai ON ri.id = ai.rfqItemId
INNER JOIN awards a ON ai.awardId = a.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quote_items qi ON ai.quoteItemId = qi.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.item_status = 'AWARDED'
  AND a.status = 'ACTIVE'
ORDER BY ri.productName;

COMMIT;

