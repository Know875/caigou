-- 修复 RFQ-1764825205850 的中标逻辑
-- 商品：MG00R升降机
-- 一口价：¥285.00
-- 问题：豪的报价 ¥285.00 满足一口价，但赛罗（¥288.00）中标了
-- 修复：取消赛罗的 Award，恢复豪的 Award

SET @rfq_no = 'RFQ-1764825205850' COLLATE utf8mb4_unicode_ci;
SET @product_name = 'MG00R升降机' COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- 1. 获取 RFQ ID 和商品 ID
SELECT '=== 获取 RFQ 和商品信息 ===' AS section;

SET @rfq_id = (
    SELECT r.id 
    FROM rfqs r 
    WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
    LIMIT 1
);

SET @rfq_item_id = (
    SELECT ri.id 
    FROM rfq_items ri 
    WHERE ri.rfqId = @rfq_id 
      AND ri.productName COLLATE utf8mb4_unicode_ci = @product_name
    LIMIT 1
);

-- 2. 获取供应商 ID
SET @hao_id = (SELECT id FROM users WHERE username = '豪' COLLATE utf8mb4_unicode_ci LIMIT 1);
SET @sailuo_id = (SELECT id FROM users WHERE username = '赛罗' COLLATE utf8mb4_unicode_ci LIMIT 1);

-- 3. 获取报价 ID
SET @hao_quote_id = (
    SELECT q.id 
    FROM quotes q 
    WHERE q.rfqId = @rfq_id 
      AND q.supplierId = @hao_id
      AND q.status = 'AWARDED'
    ORDER BY q.submittedAt ASC
    LIMIT 1
);

SET @sailuo_quote_id = (
    SELECT q.id 
    FROM quotes q 
    WHERE q.rfqId = @rfq_id 
      AND q.supplierId = @sailuo_id
      AND q.status = 'AWARDED'
    ORDER BY q.submittedAt ASC
    LIMIT 1
);

-- 4. 获取报价项 ID
SET @hao_quote_item_id = (
    SELECT qi.id 
    FROM quote_items qi 
    WHERE qi.quoteId = @hao_quote_id 
      AND qi.rfqItemId = @rfq_item_id
    LIMIT 1
);

SET @sailuo_quote_item_id = (
    SELECT qi.id 
    FROM quote_items qi 
    WHERE qi.quoteId = @sailuo_quote_id 
      AND qi.rfqItemId = @rfq_item_id
    LIMIT 1
);

-- 5. 取消赛罗的 Award（不满足一口价）
SELECT '=== 取消赛罗的 Award ===' AS section;

UPDATE awards
SET status = 'CANCELLED',
    cancellation_reason = '修复：不满足一口价，应由豪中标（满足一口价¥285）',
    cancelled_at = NOW(),
    updatedAt = NOW()
WHERE rfqId = @rfq_id
  AND supplierId = @sailuo_id
  AND status = 'ACTIVE';

-- 删除赛罗的 AwardItem
DELETE FROM award_items
WHERE awardId IN (
    SELECT id FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @sailuo_id
      AND status = 'CANCELLED'
);

-- 6. 恢复豪的 Award（满足一口价）
SELECT '=== 恢复豪的 Award ===' AS section;

-- 检查豪是否已有 Award 记录
SET @hao_award_id = (
    SELECT id 
    FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @hao_id
      AND status = 'CANCELLED'
    LIMIT 1
);

IF @hao_award_id IS NOT NULL THEN
    -- 恢复现有的 Award
    UPDATE awards
    SET status = 'ACTIVE',
        cancellation_reason = NULL,
        cancelled_at = NULL,
        updatedAt = NOW()
    WHERE id = @hao_award_id;
    
    -- 确保 AwardItem 存在
    INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
    SELECT 
        CONCAT('ai_', SUBSTRING(MD5(CONCAT(@hao_award_id, '_', @rfq_item_id)), 1, 20)) AS id,
        @hao_award_id AS awardId,
        @rfq_item_id AS rfqItemId,
        @hao_quote_item_id AS quoteItemId,
        (SELECT price FROM quote_items WHERE id = @hao_quote_item_id) AS price,
        (SELECT COALESCE(quantity, 1) FROM rfq_items WHERE id = @rfq_item_id) AS quantity,
        NOW() AS createdAt,
        NOW() AS updatedAt
    WHERE NOT EXISTS (
        SELECT 1 FROM award_items 
        WHERE awardId = @hao_award_id 
          AND rfqItemId = @rfq_item_id
    );
ELSE
    -- 创建新的 Award
    SET @hao_award_id = CONCAT('cmip', SUBSTRING(MD5(CONCAT(@rfq_id, @hao_id, NOW(), 'fix')), 1, 21));
    
    INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt)
    VALUES (
        @hao_award_id,
        @rfq_id,
        @hao_quote_id,
        @hao_id,
        (SELECT price FROM quote_items WHERE id = @hao_quote_item_id) * (SELECT COALESCE(quantity, 1) FROM rfq_items WHERE id = @rfq_item_id),
        '一口价自动中标：MG00R升降机（报价¥285 <= 一口价¥285）',
        'ACTIVE',
        NOW(),
        NOW()
    );
    
    -- 创建 AwardItem
    INSERT INTO award_items (id, awardId, rfqItemId, quoteItemId, price, quantity, createdAt, updatedAt)
    VALUES (
        CONCAT('ai_', SUBSTRING(MD5(CONCAT(@hao_award_id, '_', @rfq_item_id)), 1, 20)),
        @hao_award_id,
        @rfq_item_id,
        @hao_quote_item_id,
        (SELECT price FROM quote_items WHERE id = @hao_quote_item_id),
        (SELECT COALESCE(quantity, 1) FROM rfq_items WHERE id = @rfq_item_id),
        NOW(),
        NOW()
    );
END IF;

-- 7. 验证修复结果
SELECT '=== 验证修复结果 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    ai.price AS award_item_price,
    qi.price AS quote_item_price,
    ri.instant_price,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '满足一口价'
        ELSE '不满足一口价'
    END AS instant_price_status
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN award_items ai ON a.id = ai.awardId
INNER JOIN quote_items qi ON ai.quoteItemId = qi.id
INNER JOIN rfq_items ri ON ai.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND ri.productName COLLATE utf8mb4_unicode_ci = @product_name
  AND a.status = 'ACTIVE'
ORDER BY a.createdAt ASC;

COMMIT;

