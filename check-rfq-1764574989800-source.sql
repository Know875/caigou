-- 检查 RFQ-1764574989800 的 source 字段
-- 查看为什么发货总览显示"电商采购"

SET @rfq_no = 'RFQ-1764574989800' COLLATE utf8mb4_unicode_ci;
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no COLLATE utf8mb4_unicode_ci);

-- 1. 查看所有 RFQ Items 的 source 字段
SELECT 
    '=== 所有 RFQ Items 的 source 字段 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.orderNo,
    ri.source as rfq_item_source,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    -- 关联的订单
    o.id as order_id,
    o.orderNo,
    o.source as order_source,
    -- 发货单数量
    COUNT(DISTINCT s.id) as shipment_count,
    -- 是否有 SUPPLIER 类型的发货单
    CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM shipments s2 
            WHERE s2.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci 
            AND s2.source = 'SUPPLIER'
        ) THEN '✅ 有供应商发货单'
        WHEN ri.trackingNo IS NOT NULL THEN '⚠️ 有 trackingNo 但没有 SUPPLIER 发货单'
        WHEN ri.source = 'ECOMMERCE' THEN '⚠️ source 是 ECOMMERCE'
        ELSE '❌ 无发货单'
    END as shipment_status
FROM rfq_items ri
LEFT JOIN orders o ON o.orderNo COLLATE utf8mb4_unicode_ci = ri.orderNo COLLATE utf8mb4_unicode_ci
LEFT JOIN shipments s ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
GROUP BY ri.id, ri.productName, ri.item_status, ri.orderNo, ri.source, ri.trackingNo, ri.carrier, ri.shipmentId, o.id, o.orderNo, o.source
ORDER BY ri.productName, ri.orderNo;

-- 2. 查看发货总览逻辑：检查哪些会显示为"电商采购"
SELECT 
    '=== 发货总览逻辑检查 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.orderNo,
    ri.source as rfq_item_source,
    ri.trackingNo,
    -- 订单信息
    o.source as order_source,
    -- 是否有 SUPPLIER 类型的发货单
    CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM shipments s 
            WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci 
            AND s.source = 'SUPPLIER'
        ) THEN '✅ 有 SUPPLIER 发货单（应显示供应商）'
        WHEN ri.source = 'ECOMMERCE' THEN '⚠️ source 是 ECOMMERCE（应显示电商采购）'
        WHEN ri.trackingNo IS NOT NULL THEN '⚠️ 有 trackingNo 但没有 SUPPLIER 发货单（应显示电商采购）'
        ELSE '❌ 无发货单（应显示电商采购）'
    END as expected_display,
    -- 供应商信息
    (
        SELECT u.username
        FROM shipments s
        INNER JOIN users u ON s.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        AND s.source = 'SUPPLIER'
        LIMIT 1
    ) as supplier_name
FROM rfq_items ri
LEFT JOIN orders o ON o.orderNo COLLATE utf8mb4_unicode_ci = ri.orderNo COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
ORDER BY ri.productName, ri.orderNo;

-- 3. 查看所有发货单的 source 字段
SELECT 
    '=== 所有发货单的 source 字段 ===' as section;

SELECT 
    s.id as shipment_id,
    s.shipmentNo,
    s.rfqItemId,
    ri.productName,
    s.source as shipment_source,
    s.supplierId,
    u.username as supplier_name,
    s.trackingNo,
    s.carrier,
    s.status,
    s.createdAt
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN users u ON s.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
ORDER BY ri.productName, s.createdAt;

-- 4. 统计：按 source 分组
SELECT 
    '=== 按 source 分组统计 ===' as section;

SELECT 
    COALESCE(ri.source, 'NULL') as rfq_item_source,
    COUNT(DISTINCT ri.id) as rfq_item_count,
    COUNT(DISTINCT CASE WHEN EXISTS (
        SELECT 1 
        FROM shipments s 
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci 
        AND s.source = 'SUPPLIER'
    ) THEN ri.id END) as has_supplier_shipment_count
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
GROUP BY ri.source;

