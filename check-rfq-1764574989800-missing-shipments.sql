-- 检查为什么某些 RFQ Item 有 trackingNo 但没有 SUPPLIER 类型的发货单
-- 这些 RFQ Item 会显示为"电商采购"而不是供应商名称

SET @rfq_no = 'RFQ-1764574989800' COLLATE utf8mb4_unicode_ci;
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no COLLATE utf8mb4_unicode_ci);

-- 1. 查看有 trackingNo 但没有 SUPPLIER 发货单的 RFQ Items
SELECT 
    '=== 有 trackingNo 但没有 SUPPLIER 发货单的 RFQ Items ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.orderNo,
    ri.source as rfq_item_source,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    ri.createdAt as rfq_item_created_at,
    ri.updatedAt as rfq_item_updated_at,
    -- 检查是否有任何发货单
    (
        SELECT COUNT(*)
        FROM shipments s
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
    ) as total_shipment_count,
    -- 检查是否有 SUPPLIER 类型的发货单
    (
        SELECT COUNT(*)
        FROM shipments s
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        AND s.source = 'SUPPLIER'
    ) as supplier_shipment_count,
    -- 检查是否有 ECOMMERCE 类型的发货单
    (
        SELECT COUNT(*)
        FROM shipments s
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        AND s.source = 'ECOMMERCE'
    ) as ecommerce_shipment_count,
    -- 查看所有发货单
    (
        SELECT GROUP_CONCAT(
            CONCAT(s.id, ':', s.source, ':', COALESCE(s.trackingNo, 'NULL'), ':', COALESCE(s.supplierId, 'NULL'))
            SEPARATOR ' | '
        )
        FROM shipments s
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
    ) as all_shipments
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
AND ri.trackingNo IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM shipments s
    WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
    AND s.source = 'SUPPLIER'
)
ORDER BY ri.productName, ri.orderNo;

-- 2. 查看这些 RFQ Items 的 shipmentId 字段指向什么
SELECT 
    '=== RFQ Item 的 shipmentId 字段指向 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.shipmentId as rfq_item_shipment_id,
    -- 检查这个 shipmentId 是否存在
    CASE 
        WHEN ri.shipmentId IS NULL THEN 'NULL'
        WHEN EXISTS (
            SELECT 1
            FROM shipments s
            WHERE s.id COLLATE utf8mb4_unicode_ci = ri.shipmentId COLLATE utf8mb4_unicode_ci
        ) THEN '✅ 存在'
        ELSE '❌ 不存在（可能已被删除）'
    END as shipment_exists,
    -- 如果存在，查看这个发货单的详细信息
    s.id as shipment_id,
    s.source as shipment_source,
    s.supplierId,
    u.username as supplier_name,
    s.trackingNo as shipment_tracking_no,
    s.carrier,
    s.status,
    s.createdAt as shipment_created_at
FROM rfq_items ri
LEFT JOIN shipments s ON s.id COLLATE utf8mb4_unicode_ci = ri.shipmentId COLLATE utf8mb4_unicode_ci
LEFT JOIN users u ON s.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
AND ri.trackingNo IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM shipments s2
    WHERE s2.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
    AND s2.source = 'SUPPLIER'
)
ORDER BY ri.productName, ri.orderNo;

-- 3. 查看这些 RFQ Items 的中标信息
SELECT 
    '=== 这些 RFQ Items 的中标信息 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    -- 中标信息
    a.id as award_id,
    a.status as award_status,
    a.supplierId,
    u.username as supplier_name,
    a.createdAt as award_created_at,
    -- 报价信息
    qi.id as quote_item_id,
    qi.price,
    q.id as quote_id,
    q.submittedAt
FROM rfq_items ri
LEFT JOIN awards a ON a.rfqId COLLATE utf8mb4_unicode_ci = BINARY @rfq_id
    AND a.status = 'ACTIVE'
LEFT JOIN quotes q ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
LEFT JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
    AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN users u ON a.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
AND ri.trackingNo IS NOT NULL
AND NOT EXISTS (
    SELECT 1
    FROM shipments s
    WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
    AND s.source = 'SUPPLIER'
)
ORDER BY ri.productName, ri.orderNo, qi.price;

