-- 检查 RFQ-1764825205850 的中标逻辑
-- 商品：MG00R升降机
-- 一口价：¥285.00
-- 问题：豪的报价 ¥285.00 满足一口价，但赛罗（¥288.00）中标了

SET @rfq_no = 'RFQ-1764825205850' COLLATE utf8mb4_unicode_ci;
SET @product_name = 'MG00R升降机' COLLATE utf8mb4_unicode_ci;

SELECT '=== RFQ 基本信息 ===' AS section;

SELECT 
    r.id AS rfq_id,
    r.rfqNo,
    r.title,
    r.status AS rfq_status,
    r.closeTime
FROM rfqs r
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no;

SELECT '=== 商品基本信息 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.item_status,
    ri.max_price,
    ri.instant_price,
    ri.orderNo
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.productName COLLATE utf8mb4_unicode_ci = @product_name;

SELECT '=== 所有供应商的报价 ===' AS section;

SELECT 
    q.id AS quote_id,
    u.username AS supplier_name,
    q.supplierId,
    q.price AS quote_total_price,
    q.status AS quote_status,
    q.submittedAt,
    q.createdAt,
    qi.id AS quote_item_id,
    qi.price AS quote_item_price,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '满足一口价'
        ELSE '不满足一口价'
    END AS instant_price_status
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON q.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.productName COLLATE utf8mb4_unicode_ci = @product_name
ORDER BY qi.price ASC, q.submittedAt ASC;

SELECT '=== 所有 Award 记录 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.supplierId,
    a.quoteId,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    a.createdAt,
    a.cancelled_at,
    a.cancellation_reason
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN rfqs r ON a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
ORDER BY a.createdAt ASC;

SELECT '=== AwardItem 记录（明确的中标商品） ===' AS section;

SELECT 
    ai.id AS award_item_id,
    ai.awardId,
    ai.rfqItemId,
    ai.quoteItemId,
    ai.price AS award_item_price,
    ai.quantity,
    u.username AS supplier_name,
    ri.productName,
    qi.price AS quote_item_price,
    ri.instant_price,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '满足一口价'
        ELSE '不满足一口价'
    END AS instant_price_status
FROM award_items ai
INNER JOIN awards a ON ai.awardId = a.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN rfq_items ri ON ai.rfqItemId = ri.id
INNER JOIN quote_items qi ON ai.quoteItemId = qi.id
INNER JOIN rfqs r ON a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.productName COLLATE utf8mb4_unicode_ci = @product_name
ORDER BY a.createdAt ASC;

SELECT '=== 分析：应该中标的供应商 ===' AS section;

SELECT 
    u.username AS supplier_name,
    q.id AS quote_id,
    qi.price AS quote_price,
    q.submittedAt,
    ri.instant_price,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '应该中标（满足一口价）'
        ELSE '不应该中标（不满足一口价）'
    END AS should_award,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '按一口价逻辑：先提交者中标'
        ELSE '按价格逻辑：最低价中标'
    END AS award_logic
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON q.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.productName COLLATE utf8mb4_unicode_ci = @product_name
ORDER BY 
    CASE WHEN qi.price <= ri.instant_price THEN 0 ELSE 1 END, -- 满足一口价的优先
    CASE WHEN qi.price <= ri.instant_price THEN q.submittedAt ELSE qi.price END ASC; -- 一口价按提交时间，否则按价格

