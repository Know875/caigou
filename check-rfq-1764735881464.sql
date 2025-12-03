-- 检查 RFQ-1764735881464 的详细情况

SET @rfq_no = 'RFQ-1764735881464';

-- 1. 查看 RFQ 基本信息
SELECT '=== RFQ 基本信息 ===' AS section;
SELECT 
    r.id AS rfq_id,
    r.rfqNo,
    r.title,
    r.status,
    r.storeId,
    s.name AS store_name,
    r.closeTime,
    r.createdAt
FROM rfqs r
LEFT JOIN stores s ON r.storeId = s.id
WHERE BINARY r.rfqNo = BINARY @rfq_no;

-- 2. 查看所有 RFQ Items
SELECT '=== 所有 RFQ Items ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.item_status,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    ri.source,
    ri.instantPrice,
    ri.maxPrice
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
ORDER BY ri.createdAt;

-- 3. 查看所有报价
SELECT '=== 所有报价 ===' AS section;
SELECT 
    q.id AS quote_id,
    u.username AS supplier_name,
    q.price AS total_price,
    q.status,
    q.submittedAt,
    COUNT(qi.id) AS item_count
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs r ON q.rfqId = r.id
LEFT JOIN quote_items qi ON qi.quoteId = q.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
GROUP BY q.id, u.username, q.price, q.status, q.submittedAt
ORDER BY q.submittedAt DESC;

-- 4. 查看所有 Award 记录
SELECT '=== 所有 Award 记录 ===' AS section;
SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status,
    a.finalPrice,
    a.reason,
    a.createdAt,
    a.cancelled_at,
    a.cancellation_reason,
    GROUP_CONCAT(ri.productName ORDER BY ri.productName) AS products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason, a.createdAt, a.cancelled_at, a.cancellation_reason
ORDER BY a.createdAt DESC;

-- 5. 查看每个商品的中标情况
SELECT '=== 每个商品的中标情况 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    u.username AS supplier_name,
    qi.price,
    a.status AS award_status,
    a.id AS award_id
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN quote_items qi ON qi.rfqItemId = ri.id
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
LEFT JOIN users u ON q.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName, qi.price ASC;

-- 6. 查看是否有重复的 Award（同一个商品有多个 ACTIVE Award）
SELECT '=== 检查重复的 Award（同一商品多个 ACTIVE Award） ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT u.username ORDER BY u.username) AS suppliers,
    GROUP_CONCAT(DISTINCT a.id ORDER BY a.id) AS award_ids
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
INNER JOIN users u ON a.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.item_status = 'AWARDED'
GROUP BY ri.id, ri.productName
HAVING COUNT(DISTINCT a.id) > 1;

-- 7. 查看所有 Shipment 记录
SELECT '=== 所有 Shipment 记录 ===' AS section;
SELECT 
    s.id AS shipment_id,
    s.shipmentNo,
    s.rfqItemId,
    ri.productName,
    s.supplierId,
    u.username AS supplier_name,
    s.trackingNo,
    s.carrier,
    s.status,
    s.source,
    s.createdAt
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN users u ON s.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
ORDER BY s.createdAt DESC;

