-- 检查 RFQ-1764574989800 的订单和商品关联关系
-- 查看发货总览显示的数据来源

SET @rfq_no = 'RFQ-1764574989800' COLLATE utf8mb4_unicode_ci;
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no COLLATE utf8mb4_unicode_ci);

-- 1. 查看 RFQ 关联的所有订单
SELECT 
    '=== RFQ 关联的所有订单 ===' as section;

SELECT 
    r.rfqNo,
    o.orderNo,
    o.productName,
    o.price,
    o.status as order_status,
    o.source as order_source,
    o.recipient,
    o.phone,
    o.address,
    o.createdAt as order_created_at,
    -- RFQ Item 关联
    ri.id as rfq_item_id,
    ri.productName as rfq_item_product_name,
    ri.item_status,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    -- 发货单
    s.id as shipment_id,
    s.shipmentNo,
    s.trackingNo as shipment_tracking_no,
    s.carrier as shipment_carrier,
    s.status as shipment_status,
    s.supplierId,
    u.username as supplier_name,
    s.createdAt as shipment_created_at
FROM rfqs r
INNER JOIN order_rfqs orfq ON orfq.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci
INNER JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci = orfq.orderId COLLATE utf8mb4_unicode_ci
LEFT JOIN rfq_items ri ON ri.orderNo COLLATE utf8mb4_unicode_ci = o.orderNo COLLATE utf8mb4_unicode_ci
LEFT JOIN shipments s ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci AND s.source = 'SUPPLIER'
LEFT JOIN users u ON s.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
WHERE BINARY r.id = BINARY @rfq_id
ORDER BY o.orderNo, ri.id;

-- 2. 查看所有 RFQ Items 及其关联的订单
SELECT 
    '=== 所有 RFQ Items 及其关联的订单 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.item_status,
    ri.orderNo,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    ri.source as rfq_item_source,
    -- 关联的订单
    o.id as order_id,
    o.orderNo,
    o.productName as order_product_name,
    o.price as order_price,
    o.status as order_status,
    o.source as order_source,
    o.recipient,
    o.phone,
    o.address,
    -- 发货单
    s.id as shipment_id,
    s.shipmentNo,
    s.trackingNo as shipment_tracking_no,
    s.carrier as shipment_carrier,
    s.status as shipment_status,
    s.supplierId,
    u.username as supplier_name,
    s.createdAt as shipment_created_at,
    -- 中标供应商
    a.id as award_id,
    a.supplierId as award_supplier_id,
    u_award.username as award_supplier_name,
    a.finalPrice
FROM rfq_items ri
LEFT JOIN orders o ON o.orderNo COLLATE utf8mb4_unicode_ci = ri.orderNo COLLATE utf8mb4_unicode_ci
LEFT JOIN shipments s ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci AND s.source = 'SUPPLIER'
LEFT JOIN users u ON s.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
-- 查找中标供应商
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        a.id,
        a.supplierId,
        a.finalPrice
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
    INNER JOIN awards a ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri2.id COLLATE utf8mb4_unicode_ci
    WHERE BINARY ri2.rfqId = BINARY @rfq_id
      AND ri2.item_status = 'AWARDED'
    AND EXISTS (
        SELECT 1 
        FROM quote_items qi2 
        WHERE qi2.quoteId COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
        AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = qi.rfqItemId COLLATE utf8mb4_unicode_ci
        AND qi2.id COLLATE utf8mb4_unicode_ci = qi.id COLLATE utf8mb4_unicode_ci
    )
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON qi3.quoteId COLLATE utf8mb4_unicode_ci = q3.id COLLATE utf8mb4_unicode_ci
        INNER JOIN awards a3 ON a3.quoteId COLLATE utf8mb4_unicode_ci = q3.id COLLATE utf8mb4_unicode_ci AND a3.status != 'CANCELLED'
        INNER JOIN rfq_items ri3 ON qi3.rfqItemId COLLATE utf8mb4_unicode_ci = ri3.id COLLATE utf8mb4_unicode_ci
        WHERE BINARY ri3.rfqId = BINARY @rfq_id
          AND ri3.item_status = 'AWARDED'
          AND BINARY qi3.rfqItemId = BINARY qi.rfqItemId
          AND EXISTS (
              SELECT 1 
              FROM quote_items qi4 
              WHERE qi4.quoteId COLLATE utf8mb4_unicode_ci = a3.quoteId COLLATE utf8mb4_unicode_ci
              AND qi4.rfqItemId COLLATE utf8mb4_unicode_ci = qi3.rfqItemId COLLATE utf8mb4_unicode_ci
              AND qi4.id COLLATE utf8mb4_unicode_ci = qi3.id COLLATE utf8mb4_unicode_ci
          )
        ORDER BY qi3.price ASC, qi3.id ASC
        LIMIT 1
    )
) as award_info ON award_info.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN users u_award ON award_info.supplierId COLLATE utf8mb4_unicode_ci = u_award.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
ORDER BY ri.productName, ri.orderNo, ri.id;

-- 3. 对比：订单数量 vs RFQ Item 数量
SELECT 
    '=== 订单数量 vs RFQ Item 数量对比 ===' as section;

SELECT 
    '订单数量' as type,
    COUNT(DISTINCT o.id) as count
FROM rfqs r
INNER JOIN order_rfqs orfq ON orfq.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci
INNER JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci = orfq.orderId COLLATE utf8mb4_unicode_ci
WHERE BINARY r.id = BINARY @rfq_id
UNION ALL
SELECT 
    'RFQ Item 数量' as type,
    COUNT(DISTINCT ri.id) as count
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
UNION ALL
SELECT 
    '有订单号的 RFQ Item' as type,
    COUNT(DISTINCT ri.id) as count
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.orderNo IS NOT NULL;

-- 4. 查看没有关联订单的 RFQ Items
SELECT 
    '=== 没有关联订单的 RFQ Items ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.item_status,
    ri.orderNo,
    ri.trackingNo,
    ri.carrier,
    ri.source
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.orderNo IS NULL;

-- 5. 查看没有关联 RFQ Item 的订单
SELECT 
    '=== 没有关联 RFQ Item 的订单 ===' as section;

SELECT 
    o.id as order_id,
    o.orderNo,
    o.productName,
    o.price,
    o.status,
    o.source,
    o.recipient,
    o.phone,
    o.address
FROM rfqs r
INNER JOIN order_rfqs orfq ON orfq.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci
INNER JOIN orders o ON o.id COLLATE utf8mb4_unicode_ci = orfq.orderId COLLATE utf8mb4_unicode_ci
WHERE BINARY r.id = BINARY @rfq_id
  AND NOT EXISTS (
      SELECT 1 
      FROM rfq_items ri 
      WHERE ri.orderNo COLLATE utf8mb4_unicode_ci = o.orderNo COLLATE utf8mb4_unicode_ci
  );

