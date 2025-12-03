-- 检查 RFQ-1764735881464 的详细数据
SET @rfq_no = 'RFQ-1764735881464';
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);

SELECT '=== RFQ 基本信息 ===' AS section;
SELECT 
    r.id AS rfq_id,
    r.rfqNo,
    r.title,
    r.status AS rfq_status,
    r.type AS rfq_type,
    r.closeTime,
    r.createdAt,
    s.name AS store_name,
    s.code AS store_code
FROM rfqs r
LEFT JOIN stores s ON BINARY r.storeId = BINARY s.id
WHERE BINARY r.rfqNo = BINARY @rfq_no;

SELECT '=== 所有商品及其状态 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.unit,
    ri.item_status,
    ri.max_price,
    ri.instant_price,
    ri.trackingNo,
    ri.carrier,
    ri.source,
    ri.shipmentId,
    ri.costPrice,
    ri.createdAt,
    ri.updatedAt
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
ORDER BY ri.productName, ri.createdAt;

SELECT '=== 所有报价 ===' AS section;
SELECT 
    q.id AS quote_id,
    u.username AS supplier_name,
    q.status AS quote_status,
    q.price AS quote_price,
    q.submittedAt,
    q.createdAt,
    COUNT(qi.id) AS item_count
FROM quotes q
INNER JOIN users u ON BINARY q.supplierId = BINARY u.id
LEFT JOIN quote_items qi ON BINARY qi.quoteId = BINARY q.id
WHERE BINARY q.rfqId = BINARY @rfq_id
GROUP BY q.id, u.username, q.status, q.price, q.submittedAt, q.createdAt
ORDER BY q.submittedAt;

SELECT '=== 所有报价项详情 ===' AS section;
SELECT 
    qi.id AS quote_item_id,
    u.username AS supplier_name,
    ri.productName,
    qi.price,
    qi.rfqItemId,
    q.status AS quote_status,
    q.submittedAt
FROM quote_items qi
INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
INNER JOIN users u ON BINARY q.supplierId = BINARY u.id
INNER JOIN rfq_items ri ON BINARY qi.rfqItemId = BINARY ri.id
WHERE BINARY q.rfqId = BINARY @rfq_id
ORDER BY ri.productName, qi.price ASC, q.submittedAt ASC;

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
    COUNT(qi.id) AS item_count,
    GROUP_CONCAT(ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
INNER JOIN users u ON BINARY a.supplierId = BINARY u.id
INNER JOIN quotes q ON BINARY a.quoteId = BINARY q.id
LEFT JOIN quote_items qi ON BINARY qi.quoteId = BINARY q.id
LEFT JOIN rfq_items ri ON BINARY qi.rfqItemId = BINARY ri.id
WHERE BINARY a.rfqId = BINARY @rfq_id
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason, a.cancellation_reason, a.createdAt, a.cancelled_at
ORDER BY a.createdAt;

SELECT '=== 每个商品的中标情况 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    -- 通过 Award 记录找到中标供应商
    u_award.username AS award_supplier,
    qi_award.price AS award_price,
    a_award.id AS award_id,
    a_award.status AS award_status,
    -- 最低价供应商（如果没有 Award）
    u_lowest.username AS lowest_price_supplier,
    qi_lowest.price AS lowest_price,
    -- 判断是否正确
    CASE 
        WHEN u_award.id IS NOT NULL AND BINARY u_award.id = BINARY COALESCE(u_lowest.id, '') THEN '✅ 正确（Award 与最低价一致）'
        WHEN u_award.id IS NOT NULL AND u_lowest.id IS NOT NULL AND BINARY u_award.id != BINARY u_lowest.id THEN '⚠️ 不一致（Award 与最低价不一致）'
        WHEN u_award.id IS NOT NULL THEN '✅ 有 Award 记录'
        WHEN u_lowest.id IS NOT NULL THEN '⚠️ 无 Award 记录，使用最低价'
        ELSE '❌ 无报价'
    END AS validation
FROM rfq_items ri
-- 通过 Award 记录找到中标供应商
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id AS quote_item_id,
        qi.price,
        q.supplierId,
        a.id AS award_id,
        a.status AS award_status
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    INNER JOIN awards a ON BINARY a.quoteId = BINARY q.id
        AND a.status = 'ACTIVE'
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
        AND BINARY ri2.rfqId = BINARY @rfq_id
    )
    AND EXISTS (
        SELECT 1 FROM quote_items qi2
        WHERE BINARY qi2.quoteId = BINARY a.quoteId
        AND BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        AND BINARY qi2.id = BINARY qi.id
    )
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON BINARY qi3.quoteId = BINARY q3.id
        INNER JOIN awards a3 ON BINARY a3.quoteId = BINARY q3.id
            AND a3.status = 'ACTIVE'
        WHERE BINARY qi3.rfqItemId = BINARY qi.rfqItemId
        ORDER BY qi3.price ASC, q3.submittedAt ASC
        LIMIT 1
    )
) AS award_quote ON BINARY award_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_award ON BINARY u_award.id = BINARY award_quote.supplierId
LEFT JOIN quote_items qi_award ON BINARY qi_award.id = BINARY award_quote.quote_item_id
LEFT JOIN awards a_award ON BINARY a_award.id = BINARY award_quote.award_id
-- 找到最低价供应商（如果没有 Award）
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id AS quote_item_id,
        qi.price,
        q.supplierId
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND BINARY ri2.rfqId = BINARY @rfq_id
    )
    AND qi.id = (
        SELECT qi2.id
        FROM quote_items qi2
        INNER JOIN quotes q2 ON BINARY qi2.quoteId = BINARY q2.id
        WHERE BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        ORDER BY qi2.price ASC, q2.submittedAt ASC
        LIMIT 1
    )
) AS lowest_quote ON BINARY lowest_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_lowest ON BINARY u_lowest.id = BINARY lowest_quote.supplierId
LEFT JOIN quote_items qi_lowest ON BINARY qi_lowest.id = BINARY lowest_quote.quote_item_id
WHERE BINARY ri.rfqId = BINARY @rfq_id
ORDER BY ri.productName;

SELECT '=== 所有发货单 ===' AS section;
SELECT 
    s.id AS shipment_id,
    s.shipmentNo,
    u.username AS supplier_name,
    ri.productName,
    s.trackingNo,
    s.carrier,
    s.status AS shipment_status,
    s.source,
    s.createdAt
FROM shipments s
INNER JOIN rfq_items ri ON BINARY s.rfqItemId = BINARY ri.id
LEFT JOIN users u ON BINARY s.supplierId = BINARY u.id
WHERE BINARY ri.rfqId = BINARY @rfq_id
ORDER BY s.createdAt;

SELECT '=== 每个商品的发货情况 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    -- 中标供应商
    u_award.username AS award_supplier,
    -- 发货单信息
    s.id AS shipment_id,
    s.shipmentNo,
    u_shipment.username AS shipment_supplier,
    s.trackingNo,
    s.carrier,
    s.status AS shipment_status,
    s.source,
    -- 判断是否正确
    CASE 
        WHEN s.id IS NULL THEN '✅ 无发货单'
        WHEN BINARY u_award.id = BINARY u_shipment.id THEN '✅ 正确（中标供应商上传）'
        WHEN u_award.id IS NOT NULL AND u_shipment.id IS NOT NULL AND BINARY u_award.id != BINARY u_shipment.id THEN '❌ 错误（非中标供应商上传）'
        WHEN u_award.id IS NULL THEN '⚠️ 无中标供应商'
        ELSE '⚠️ 需要检查'
    END AS validation
FROM rfq_items ri
-- 通过 Award 记录找到中标供应商
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        q.supplierId
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    INNER JOIN awards a ON BINARY a.quoteId = BINARY q.id
        AND a.status = 'ACTIVE'
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
        AND BINARY ri2.rfqId = BINARY @rfq_id
    )
    AND EXISTS (
        SELECT 1 FROM quote_items qi2
        WHERE BINARY qi2.quoteId = BINARY a.quoteId
        AND BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        AND BINARY qi2.id = BINARY qi.id
    )
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON BINARY qi3.quoteId = BINARY q3.id
        INNER JOIN awards a3 ON BINARY a3.quoteId = BINARY q3.id
            AND a3.status = 'ACTIVE'
        WHERE BINARY qi3.rfqItemId = BINARY qi.rfqItemId
        ORDER BY qi3.price ASC, q3.submittedAt ASC
        LIMIT 1
    )
) AS award_quote ON BINARY award_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_award ON BINARY u_award.id = BINARY award_quote.supplierId
-- 发货单信息
LEFT JOIN shipments s ON BINARY s.rfqItemId = BINARY ri.id
LEFT JOIN users u_shipment ON BINARY s.supplierId = BINARY u_shipment.id
WHERE BINARY ri.rfqId = BINARY @rfq_id
ORDER BY ri.productName;

