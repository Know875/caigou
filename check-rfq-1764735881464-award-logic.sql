-- 检查 RFQ-1764735881464 的中标逻辑
SET @rfq_no = 'RFQ-1764735881464';

SELECT '=== RFQ 基本信息 ===' AS section;

SELECT 
    r.id AS rfq_id,
    r.rfqNo,
    r.title,
    r.status AS rfq_status,
    r.storeId,
    s.name AS store_name,
    r.closeTime,
    r.createdAt
FROM rfqs r
LEFT JOIN stores s ON r.storeId = s.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci;

SELECT '=== 所有商品及其状态 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    ri.trackingNo,
    ri.carrier,
    ri.source
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
ORDER BY ri.productName;

SELECT '=== 所有报价 ===' AS section;

SELECT 
    q.id AS quote_id,
    u.username AS supplier_name,
    q.price AS total_price,
    q.status AS quote_status,
    q.submittedAt,
    q.createdAt,
    (SELECT COUNT(*) FROM quote_items qi WHERE qi.quoteId = q.id) AS item_count
FROM quotes q
INNER JOIN rfqs r ON q.rfqId = r.id
INNER JOIN users u ON q.supplierId = u.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
ORDER BY q.submittedAt;

SELECT '=== 所有报价项详情 ===' AS section;

SELECT 
    qi.id AS quote_item_id,
    u.username AS supplier_name,
    ri.productName,
    qi.price,
    ri.id AS rfqItemId,
    q.status AS quote_status,
    q.submittedAt
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN users u ON q.supplierId = u.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
ORDER BY ri.productName, qi.price, q.submittedAt;

SELECT '=== 所有 Award 记录 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    a.cancellation_reason,
    a.createdAt,
    a.cancelled_at,
    (SELECT COUNT(*) FROM quote_items qi 
     INNER JOIN quotes q2 ON qi.quoteId = q2.id 
     WHERE q2.id = a.quoteId) AS item_count,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
INNER JOIN rfqs r ON a.rfqId = r.id
INNER JOIN users u ON a.supplierId = u.id
LEFT JOIN quotes q ON a.quoteId = q.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId
LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason, a.cancellation_reason, a.createdAt, a.cancelled_at
ORDER BY a.status, a.createdAt;

SELECT '=== 每个商品的中标情况（按逻辑判断） ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    -- 通过 Award 记录确定的中标供应商
    (SELECT u2.username 
     FROM awards a2
     INNER JOIN quotes q2 ON a2.quoteId = q2.id
     INNER JOIN quote_items qi2 ON q2.id = qi2.quoteId
     INNER JOIN users u2 ON a2.supplierId = u2.id
     WHERE a2.rfqId = r.id
       AND a2.status = 'ACTIVE'
       AND qi2.rfqItemId = ri.id
     ORDER BY a2.createdAt DESC
     LIMIT 1) AS award_supplier,
    -- 通过 Award 记录确定的中标价格
    (SELECT qi2.price 
     FROM awards a2
     INNER JOIN quotes q2 ON a2.quoteId = q2.id
     INNER JOIN quote_items qi2 ON q2.id = qi2.quoteId
     WHERE a2.rfqId = r.id
       AND a2.status = 'ACTIVE'
       AND qi2.rfqItemId = ri.id
     ORDER BY a2.createdAt DESC
     LIMIT 1) AS award_price,
    -- 最低价供应商（如果没有 Award）
    (SELECT u3.username 
     FROM quote_items qi3
     INNER JOIN quotes q3 ON qi3.quoteId = q3.id
     INNER JOIN users u3 ON q3.supplierId = u3.id
     WHERE qi3.rfqItemId = ri.id
     ORDER BY qi3.price ASC, q3.submittedAt ASC
     LIMIT 1) AS lowest_price_supplier,
    -- 最低价
    (SELECT qi3.price 
     FROM quote_items qi3
     INNER JOIN quotes q3 ON qi3.quoteId = q3.id
     WHERE qi3.rfqItemId = ri.id
     ORDER BY qi3.price ASC, q3.submittedAt ASC
     LIMIT 1) AS lowest_price,
    -- 一口价满足的供应商（如果有）
    CASE 
        WHEN ri.instant_price IS NOT NULL THEN
            (SELECT u4.username 
             FROM quote_items qi4
             INNER JOIN quotes q4 ON qi4.quoteId = q4.id
             INNER JOIN users u4 ON q4.supplierId = u4.id
             WHERE qi4.rfqItemId = ri.id
               AND qi4.price <= ri.instant_price
             ORDER BY q4.submittedAt ASC
             LIMIT 1)
        ELSE NULL
    END AS instant_price_supplier,
    -- 一口价满足的价格
    CASE 
        WHEN ri.instant_price IS NOT NULL THEN
            (SELECT qi4.price 
             FROM quote_items qi4
             INNER JOIN quotes q4 ON qi4.quoteId = q4.id
             WHERE qi4.rfqItemId = ri.id
               AND qi4.price <= ri.instant_price
             ORDER BY q4.submittedAt ASC
             LIMIT 1)
        ELSE NULL
    END AS instant_price_quote_price
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
ORDER BY ri.productName;

SELECT '=== 检查重复的 Award（同一商品多个 ACTIVE Award） ===' AS section;

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

SELECT '=== 检查商品状态与 Award 的一致性 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    CASE 
        WHEN ri.item_status = 'AWARDED' AND NOT EXISTS (
            SELECT 1 FROM awards a
            INNER JOIN quotes q ON a.quoteId = q.id
            INNER JOIN quote_items qi ON q.id = qi.quoteId
            WHERE a.rfqId = r.id
              AND a.status = 'ACTIVE'
              AND qi.rfqItemId = ri.id
        ) THEN '❌ 商品状态为 AWARDED 但没有 ACTIVE Award'
        WHEN ri.item_status != 'AWARDED' AND EXISTS (
            SELECT 1 FROM awards a
            INNER JOIN quotes q ON a.quoteId = q.id
            INNER JOIN quote_items qi ON q.id = qi.quoteId
            WHERE a.rfqId = r.id
              AND a.status = 'ACTIVE'
              AND qi.rfqItemId = ri.id
        ) THEN '❌ 商品状态不是 AWARDED 但有 ACTIVE Award'
        ELSE '✅ 一致'
    END AS validation
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
ORDER BY ri.productName;

