-- 检查 RFQ-1764574989800 的商品数量
-- 查看原始 RFQ 中有多少个不同的商品，特别是100元福袋

SET @rfq_no = 'RFQ-1764574989800' COLLATE utf8mb4_unicode_ci;
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no COLLATE utf8mb4_unicode_ci);

-- 1. 查看 RFQ 基本信息
SELECT 
    '=== RFQ 基本信息 ===' as section;

SELECT 
    r.rfqNo,
    r.title,
    r.status,
    r.createdAt,
    COUNT(DISTINCT ri.id) as total_items_count
FROM rfqs r
LEFT JOIN rfq_items ri ON ri.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci
WHERE BINARY r.id = BINARY @rfq_id
GROUP BY r.id, r.rfqNo, r.title, r.status, r.createdAt;

-- 2. 查看所有商品明细（按商品名称分组）
SELECT 
    '=== 所有商品明细（按商品名称分组） ===' as section;

SELECT 
    ri.productName,
    COUNT(DISTINCT ri.id) as item_count,
    GROUP_CONCAT(DISTINCT ri.id ORDER BY ri.id SEPARATOR ', ') as rfq_item_ids,
    SUM(ri.quantity) as total_quantity,
    GROUP_CONCAT(DISTINCT ri.item_status ORDER BY ri.item_status SEPARATOR ', ') as statuses
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
GROUP BY ri.productName
ORDER BY ri.productName;

-- 3. 查看所有商品明细（详细列表）
SELECT 
    '=== 所有商品明细（详细列表） ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.unit,
    ri.item_status,
    ri.createdAt,
    ri.updatedAt,
    -- 报价数量
    COUNT(DISTINCT qi.id) as quote_item_count,
    -- 中标情况
    CASE 
        WHEN ri.item_status = 'AWARDED' THEN '✅ 已中标'
        ELSE '❌ 未中标'
    END as award_status,
    -- 发货单数量
    COUNT(DISTINCT s.id) as shipment_count
FROM rfq_items ri
LEFT JOIN quote_items qi ON qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN shipments s ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci AND s.source = 'SUPPLIER'
WHERE BINARY ri.rfqId = BINARY @rfq_id
GROUP BY ri.id, ri.productName, ri.quantity, ri.unit, ri.item_status, ri.createdAt, ri.updatedAt
ORDER BY ri.productName, ri.createdAt;

-- 4. 特别检查100元福袋商品
SELECT 
    '=== 100元福袋商品详情 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.quantity,
    ri.unit,
    ri.item_status,
    ri.createdAt,
    ri.updatedAt,
    -- 报价数量
    COUNT(DISTINCT qi.id) as quote_item_count,
    -- 发货单数量
    COUNT(DISTINCT s.id) as shipment_count,
    -- 发货单ID列表
    GROUP_CONCAT(DISTINCT s.id ORDER BY s.createdAt SEPARATOR ', ') as shipment_ids
FROM rfq_items ri
LEFT JOIN quote_items qi ON qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN shipments s ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci AND s.source = 'SUPPLIER'
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.productName LIKE '%100元福袋%'
GROUP BY ri.id, ri.productName, ri.quantity, ri.unit, ri.item_status, ri.createdAt, ri.updatedAt
ORDER BY ri.createdAt;

-- 5. 检查是否有重复的商品（相同商品名称、相同数量）
SELECT 
    '=== 检查重复商品 ===' as section;

SELECT 
    ri.productName,
    ri.quantity,
    COUNT(*) as duplicate_count,
    GROUP_CONCAT(ri.id ORDER BY ri.id SEPARATOR ', ') as rfq_item_ids,
    GROUP_CONCAT(ri.item_status ORDER BY ri.id SEPARATOR ', ') as statuses
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
GROUP BY ri.productName, ri.quantity
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, ri.productName;

