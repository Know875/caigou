-- 检查 RFQ-1764311261614 中 PGZ高达 的重复数据

SET @rfq_no = 'RFQ-1764311261614';
SET @product_name = 'PGZ高达';
SET @supplier_name = '豪';

-- 1. 查看 RFQ 基本信息
SELECT '=== RFQ 基本信息 ===' AS section;
SELECT 
    r.id AS rfq_id,
    r.rfqNo,
    r.title,
    r.status,
    r.storeId,
    s.name AS store_name
FROM rfqs r
LEFT JOIN stores s ON r.storeId = s.id
WHERE BINARY r.rfqNo = BINARY @rfq_no;

-- 2. 查看所有 PGZ高达 的 RFQ Item
SELECT '=== 所有 PGZ高达 的 RFQ Item ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.item_status,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    ri.source,
    ri.orderNo
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.productName LIKE '%PGZ高达%'
ORDER BY ri.createdAt;

-- 3. 查看豪对 PGZ高达 的所有报价项
SELECT '=== 豪对 PGZ高达 的所有报价项 ===' AS section;
SELECT 
    qi.id AS quote_item_id,
    q.id AS quote_id,
    ri.id AS rfq_item_id,
    ri.productName,
    qi.price,
    ri.item_status,
    ri.trackingNo,
    ri.shipmentId,
    s.id AS shipment_id,
    s.trackingNo AS shipment_tracking_no,
    s.status AS shipment_status
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN shipments s ON s.rfqItemId = ri.id AND s.supplierId = u.id AND s.source = 'SUPPLIER'
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.productName LIKE '%PGZ高达%'
  AND u.username COLLATE utf8mb4_unicode_ci = @supplier_name COLLATE utf8mb4_unicode_ci
ORDER BY ri.createdAt, qi.price;

-- 4. 查看豪的 Award 和 Quote 信息
SELECT '=== 豪的 Award 和 Quote 信息 ===' AS section;
SELECT 
    a.id AS award_id,
    a.rfqId,
    a.quoteId,
    a.supplierId,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.createdAt,
    q.status AS quote_status,
    GROUP_CONCAT(qi.id ORDER BY qi.id) AS quote_item_ids,
    GROUP_CONCAT(ri.productName ORDER BY qi.id) AS product_names,
    GROUP_CONCAT(ri.id ORDER BY qi.id) AS rfq_item_ids
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND u.username COLLATE utf8mb4_unicode_ci = @supplier_name COLLATE utf8mb4_unicode_ci
  AND a.status != 'CANCELLED'
GROUP BY a.id, a.rfqId, a.quoteId, a.supplierId, u.username, a.status, a.finalPrice, a.createdAt, q.status;

-- 5. 查看相关的 Shipment 记录
SELECT '=== 相关的 Shipment 记录 ===' AS section;
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
  AND (ri.productName LIKE '%PGZ高达%' OR u.username COLLATE utf8mb4_unicode_ci = @supplier_name COLLATE utf8mb4_unicode_ci)
ORDER BY s.createdAt DESC;

