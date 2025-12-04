-- 查看 RFQ-1764825205850 的所有数据
-- 全面分析询价单、商品、报价、中标情况

SET @rfq_no = 'RFQ-1764825205850' COLLATE utf8mb4_unicode_ci;

SELECT '=== 1. RFQ 基本信息 ===' AS section;

SELECT 
    r.id AS rfq_id,
    r.rfqNo,
    r.title,
    r.description,
    r.type AS rfq_type,
    r.status AS rfq_status,
    r.deadline,
    r.closeTime,
    r.storeId,
    s.name AS store_name,
    r.buyerId,
    u_buyer.username AS buyer_name,
    r.createdAt,
    r.updatedAt
FROM rfqs r
LEFT JOIN stores s ON r.storeId = s.id
LEFT JOIN users u_buyer ON r.buyerId = u_buyer.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no;

SELECT '=== 2. 所有商品信息 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.unit,
    ri.description,
    ri.notes,
    ri.item_status,
    ri.max_price,
    ri.instant_price,
    ri.orderNo,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    ri.source,
    ri.costPrice,
    ri.exception_reason,
    ri.exception_at,
    ri.createdAt,
    ri.updatedAt
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
ORDER BY ri.createdAt ASC;

SELECT '=== 3. 所有供应商的报价（按供应商分组） ===' AS section;

SELECT 
    q.id AS quote_id,
    u.username AS supplier_name,
    q.supplierId,
    q.price AS quote_total_price,
    q.deliveryDays,
    q.notes AS quote_notes,
    q.status AS quote_status,
    q.submittedAt,
    q.createdAt AS quote_createdAt,
    q.updatedAt AS quote_updatedAt,
    COUNT(qi.id) AS item_count
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs r ON q.rfqId = r.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
GROUP BY q.id, u.username, q.supplierId, q.price, q.deliveryDays, q.notes, q.status, q.submittedAt, q.createdAt, q.updatedAt
ORDER BY q.submittedAt ASC;

SELECT '=== 4. 所有报价项详情（按商品分组） ===' AS section;

SELECT 
    ri.productName,
    ri.id AS rfq_item_id,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    u.username AS supplier_name,
    q.id AS quote_id,
    q.status AS quote_status,
    q.submittedAt,
    qi.id AS quote_item_id,
    qi.price AS quote_item_price,
    qi.deliveryDays,
    qi.notes AS quote_item_notes,
    CASE 
        WHEN ri.instant_price IS NOT NULL AND qi.price <= ri.instant_price THEN '满足一口价'
        WHEN ri.instant_price IS NOT NULL AND qi.price > ri.instant_price THEN '不满足一口价'
        ELSE '无一口价'
    END AS instant_price_status,
    CASE 
        WHEN ri.max_price IS NOT NULL AND qi.price <= ri.max_price THEN '满足最高限价'
        WHEN ri.max_price IS NOT NULL AND qi.price > ri.max_price THEN '超过最高限价'
        ELSE '无最高限价'
    END AS max_price_status
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON q.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
ORDER BY ri.productName, qi.price ASC, q.submittedAt ASC;

SELECT '=== 5. 所有 Award 记录 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.supplierId,
    a.quoteId,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    a.awardedAt,
    a.paymentQrCodeUrl,
    a.createdAt AS award_createdAt,
    a.updatedAt AS award_updatedAt,
    a.cancellation_reason,
    a.cancelled_at,
    a.cancelled_by
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN rfqs r ON a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
ORDER BY a.createdAt ASC;

SELECT '=== 6. 所有 AwardItem 记录（明确的中标商品） ===' AS section;

SELECT 
    ai.id AS award_item_id,
    ai.awardId,
    u.username AS supplier_name,
    ri.productName,
    ri.id AS rfq_item_id,
    ri.item_status,
    ri.instant_price,
    ai.quoteItemId,
    ai.price AS award_item_price,
    ai.quantity AS award_item_quantity,
    qi.price AS quote_item_price,
    a.status AS award_status,
    a.reason AS award_reason,
    a.createdAt AS award_createdAt,
    CASE 
        WHEN ri.instant_price IS NOT NULL AND qi.price <= ri.instant_price THEN '满足一口价'
        WHEN ri.instant_price IS NOT NULL AND qi.price > ri.instant_price THEN '不满足一口价'
        ELSE '无一口价'
    END AS instant_price_status
FROM award_items ai
INNER JOIN awards a ON ai.awardId = a.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN rfq_items ri ON ai.rfqItemId = ri.id
INNER JOIN quote_items qi ON ai.quoteItemId = qi.id
INNER JOIN rfqs r ON a.rfqId = r.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
ORDER BY ri.productName, a.createdAt ASC;

SELECT '=== 7. 每个商品的中标情况分析 ===' AS section;

SELECT 
    ri.productName,
    ri.id AS rfq_item_id,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    -- 当前中标供应商
    u_award.username AS current_award_supplier,
    a_award.status AS current_award_status,
    qi_award.price AS current_award_price,
    a_award.reason AS current_award_reason,
    -- 应该中标的供应商（按一口价逻辑）
    CASE 
        WHEN ri.instant_price IS NOT NULL THEN (
            SELECT u2.username
            FROM quote_items qi2
            INNER JOIN quotes q2 ON qi2.quoteId = q2.id
            INNER JOIN users u2 ON q2.supplierId = u2.id
            WHERE qi2.rfqItemId = ri.id
              AND qi2.price <= ri.instant_price
              AND (q2.status = 'SUBMITTED' OR q2.status = 'AWARDED')
            ORDER BY q2.submittedAt ASC
            LIMIT 1
        )
        ELSE (
            SELECT u2.username
            FROM quote_items qi2
            INNER JOIN quotes q2 ON qi2.quoteId = q2.id
            INNER JOIN users u2 ON q2.supplierId = u2.id
            WHERE qi2.rfqItemId = ri.id
              AND (q2.status = 'SUBMITTED' OR q2.status = 'AWARDED')
            ORDER BY qi2.price ASC, q2.submittedAt ASC
            LIMIT 1
        )
    END AS should_award_supplier,
    -- 应该中标的报价
    CASE 
        WHEN ri.instant_price IS NOT NULL THEN (
            SELECT qi2.price
            FROM quote_items qi2
            INNER JOIN quotes q2 ON qi2.quoteId = q2.id
            WHERE qi2.rfqItemId = ri.id
              AND qi2.price <= ri.instant_price
              AND (q2.status = 'SUBMITTED' OR q2.status = 'AWARDED')
            ORDER BY q2.submittedAt ASC
            LIMIT 1
        )
        ELSE (
            SELECT qi2.price
            FROM quote_items qi2
            INNER JOIN quotes q2 ON qi2.quoteId = q2.id
            WHERE qi2.rfqItemId = ri.id
              AND (q2.status = 'SUBMITTED' OR q2.status = 'AWARDED')
            ORDER BY qi2.price ASC, q2.submittedAt ASC
            LIMIT 1
        )
    END AS should_award_price,
    -- 是否一致
    CASE 
        WHEN u_award.username IS NULL THEN '未中标'
        WHEN u_award.username = (
            CASE 
                WHEN ri.instant_price IS NOT NULL THEN (
                    SELECT u2.username
                    FROM quote_items qi2
                    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
                    INNER JOIN users u2 ON q2.supplierId = u2.id
                    WHERE qi2.rfqItemId = ri.id
                      AND qi2.price <= ri.instant_price
                      AND (q2.status = 'SUBMITTED' OR q2.status = 'AWARDED')
                    ORDER BY q2.submittedAt ASC
                    LIMIT 1
                )
                ELSE (
                    SELECT u2.username
                    FROM quote_items qi2
                    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
                    INNER JOIN users u2 ON q2.supplierId = u2.id
                    WHERE qi2.rfqItemId = ri.id
                      AND (q2.status = 'SUBMITTED' OR q2.status = 'AWARDED')
                    ORDER BY qi2.price ASC, q2.submittedAt ASC
                    LIMIT 1
                )
            END
        ) THEN '一致'
        ELSE '不一致（需要修复）'
    END AS award_status_check
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN award_items ai_current ON ri.id = ai_current.rfqItemId
LEFT JOIN awards a_award ON ai_current.awardId = a_award.id AND a_award.status = 'ACTIVE'
LEFT JOIN users u_award ON a_award.supplierId = u_award.id
LEFT JOIN quote_items qi_award ON ai_current.quoteItemId = qi_award.id
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
ORDER BY ri.productName;

SELECT '=== 8. 所有供应商的报价统计 ===' AS section;

SELECT 
    u.username AS supplier_name,
    COUNT(DISTINCT q.id) AS quote_count,
    COUNT(DISTINCT qi.id) AS quote_item_count,
    SUM(CASE WHEN a.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active_award_count,
    SUM(CASE WHEN a.status = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_award_count,
    SUM(CASE WHEN a.status = 'ACTIVE' THEN a.finalPrice ELSE 0 END) AS active_award_total_price
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs r ON q.rfqId = r.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId
LEFT JOIN awards a ON q.id = a.quoteId
WHERE r.rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no
GROUP BY u.username, u.id
ORDER BY active_award_total_price DESC, u.username;

