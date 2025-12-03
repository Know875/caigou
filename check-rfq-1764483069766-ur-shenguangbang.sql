-- 检查 RFQ-1764483069766 中 UR神光棒 的相关数据
-- 目标：将 UR神光棒 从赛罗移动到豪

SET @rfq_no = 'RFQ-1764483069766';
SET @product_name = 'UR神光棒';

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

-- 2. 查看 UR神光棒 的 RFQ Item 信息
SELECT '=== UR神光棒 RFQ Item 信息 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.item_status,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    ri.source
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.productName LIKE '%UR神光棒%';

-- 3. 查看所有供应商对该商品的报价
SELECT '=== 所有供应商对 UR神光棒 的报价 ===' AS section;
SELECT 
    qi.id AS quote_item_id,
    q.id AS quote_id,
    q.supplierId,
    u.username AS supplier_name,
    qi.price,
    q.submittedAt,
    q.status AS quote_status
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.productName LIKE '%UR神光棒%'
ORDER BY qi.price ASC, q.submittedAt ASC;

-- 4. 查看赛罗的 Award 和 Quote 信息
SELECT '=== 赛罗的 Award 和 Quote 信息 ===' AS section;
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
    GROUP_CONCAT(ri.productName ORDER BY qi.id) AS product_names
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND u.username = '赛罗'
  AND a.status != 'CANCELLED'
GROUP BY a.id, a.rfqId, a.quoteId, a.supplierId, u.username, a.status, a.finalPrice, a.createdAt, q.status;

-- 5. 查看豪的 Award 和 Quote 信息
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
    GROUP_CONCAT(ri.productName ORDER BY qi.id) AS product_names
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND u.username = '豪'
  AND a.status != 'CANCELLED'
GROUP BY a.id, a.rfqId, a.quoteId, a.supplierId, u.username, a.status, a.finalPrice, a.createdAt, q.status;

-- 6. 查看赛罗的 Quote 包含的所有商品
SELECT '=== 赛罗的 Quote 包含的所有商品 ===' AS section;
SELECT 
    q.id AS quote_id,
    qi.id AS quote_item_id,
    ri.id AS rfq_item_id,
    ri.productName,
    qi.price,
    ri.item_status
FROM quotes q
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN users u ON q.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND u.username = '赛罗'
ORDER BY ri.productName;

-- 7. 查看豪的 Quote 包含的所有商品
SELECT '=== 豪的 Quote 包含的所有商品 ===' AS section;
SELECT 
    q.id AS quote_id,
    qi.id AS quote_item_id,
    ri.id AS rfq_item_id,
    ri.productName,
    qi.price,
    ri.item_status
FROM quotes q
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN users u ON q.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND u.username = '豪'
ORDER BY ri.productName;

-- 8. 查看是否有相关的 Shipment 记录
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
    s.source
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN users u ON s.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND (ri.productName LIKE '%UR神光棒%' OR u.username IN ('赛罗', '豪'))
ORDER BY s.createdAt DESC;

