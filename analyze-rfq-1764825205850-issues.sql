-- 分析 RFQ-1764825205850 的问题
-- 重点关注：龙骑真骨雕、MG暴风、SHF灵骑

SET @rfq_no = 'RFQ-1764825205850' COLLATE utf8mb4_unicode_ci;

SELECT '=== 问题商品 1: 龙骑真骨雕 ===' AS section;

SELECT 
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    u.username AS supplier_name,
    q.id AS quote_id,
    q.status AS quote_status,
    q.submittedAt,
    qi.price AS quote_item_price,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '满足一口价'
        ELSE '不满足一口价'
    END AS instant_price_status,
    a.id AS award_id,
    a.status AS award_status,
    a.reason AS award_reason
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.productName = '龙骑真骨雕' COLLATE utf8mb4_unicode_ci
ORDER BY qi.price ASC, q.submittedAt ASC;

SELECT '=== 问题商品 2: MG暴风 ===' AS section;

SELECT 
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    u.username AS supplier_name,
    q.id AS quote_id,
    q.status AS quote_status,
    q.submittedAt,
    qi.price AS quote_item_price,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '满足一口价'
        ELSE '不满足一口价'
    END AS instant_price_status,
    a.id AS award_id,
    a.status AS award_status,
    a.reason AS award_reason
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.productName = 'MG暴风' COLLATE utf8mb4_unicode_ci
ORDER BY qi.price ASC, q.submittedAt ASC;

SELECT '=== 问题商品 3: SHF灵骑 ===' AS section;

SELECT 
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    u.username AS supplier_name,
    q.id AS quote_id,
    q.status AS quote_status,
    q.submittedAt,
    qi.price AS quote_item_price,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '满足一口价'
        ELSE '不满足一口价'
    END AS instant_price_status,
    a.id AS award_id,
    a.status AS award_status,
    a.reason AS award_reason
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.productName = 'SHF灵骑' COLLATE utf8mb4_unicode_ci
ORDER BY qi.price ASC, q.submittedAt ASC;

SELECT '=== 所有 AWARDED 状态但没有 ACTIVE Award 的商品 ===' AS section;

SELECT 
    ri.productName,
    ri.id AS rfq_item_id,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    COUNT(DISTINCT qi.id) AS quote_count,
    MIN(qi.price) AS min_quote_price,
    MAX(qi.price) AS max_quote_price,
    COUNT(DISTINCT CASE WHEN a.status = 'ACTIVE' THEN a.id END) AS active_award_count,
    COUNT(DISTINCT CASE WHEN a.status = 'CANCELLED' THEN a.id END) AS cancelled_award_count
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
  AND ri.item_status = 'AWARDED'
GROUP BY ri.id, ri.productName, ri.item_status, ri.instant_price, ri.max_price
HAVING active_award_count = 0
ORDER BY ri.productName;

