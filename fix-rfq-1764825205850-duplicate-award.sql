-- 修复 RFQ-1764825205850 的重复 Award 问题
-- MG00R升降机 现在有两个 ACTIVE 的 Award（豪和菜狗），应该只有豪（满足一口价）中标

SET @rfq_no = 'RFQ-1764825205850' COLLATE utf8mb4_unicode_ci;

START TRANSACTION;

-- 1. 获取基本信息
SELECT '=== 获取基本信息 ===' AS section;

SET @rfq_id = (
    SELECT r.id 
    FROM rfqs r 
    WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
    LIMIT 1
);

SET @mg00r_rfq_item_id = (
    SELECT ri.id 
    FROM rfq_items ri 
    WHERE ri.rfqId = @rfq_id 
      AND ri.productName = 'MG00R升降机' COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

SET @hao_id = (SELECT id FROM users WHERE username = '豪' COLLATE utf8mb4_unicode_ci LIMIT 1);
SET @caigou_id = (SELECT id FROM users WHERE username = '菜狗' COLLATE utf8mb4_unicode_ci LIMIT 1);

-- 2. 查找菜狗的 Award 中包含 MG00R升降机的 AwardItem
SELECT '=== 查找菜狗的 Award 中的 MG00R升降机 ===' AS section;

SET @caigou_award_id = (
    SELECT a.id 
    FROM awards a
    INNER JOIN award_items ai ON a.id = ai.awardId
    WHERE a.rfqId = @rfq_id
      AND a.supplierId = @caigou_id
      AND a.status = 'ACTIVE'
      AND ai.rfqItemId = @mg00r_rfq_item_id
    LIMIT 1
);

-- 3. 删除菜狗的 Award 中 MG00R升降机的 AwardItem
SELECT '=== 删除菜狗的 Award 中 MG00R升降机的 AwardItem ===' AS section;

DELETE FROM award_items
WHERE awardId = @caigou_award_id
  AND rfqItemId = @mg00r_rfq_item_id;

-- 4. 检查菜狗的 Award 是否还有其他商品
SELECT '=== 检查菜狗的 Award 是否还有其他商品 ===' AS section;

SET @caigou_award_item_count = (
    SELECT COUNT(*) 
    FROM award_items 
    WHERE awardId = @caigou_award_id
);

-- 5. 如果菜狗的 Award 还有其他商品，更新 finalPrice；如果没有其他商品，取消 Award
SELECT '=== 更新或取消菜狗的 Award ===' AS section;

-- 更新 finalPrice（无论是否还有其他商品）
UPDATE awards
SET finalPrice = (
    SELECT COALESCE(SUM(ai.price * ai.quantity), 0)
    FROM award_items ai
    WHERE ai.awardId = @caigou_award_id
),
updatedAt = NOW()
WHERE id = @caigou_award_id;

-- 如果没有其他商品了，取消 Award
UPDATE awards
SET status = 'CANCELLED',
    cancellation_reason = '修复：MG00R升降机应由豪中标（满足一口价），已移除',
    cancelled_at = NOW(),
    updatedAt = NOW()
WHERE id = @caigou_award_id
  AND NOT EXISTS (
    SELECT 1 FROM award_items 
    WHERE awardId = @caigou_award_id
  );

-- 6. 验证修复结果
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
ORDER BY ri.productName, u.username;

COMMIT;

