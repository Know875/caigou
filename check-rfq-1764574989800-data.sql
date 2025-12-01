-- 检查 RFQ-1764574989800 的数据状态
-- 用于诊断为什么前端还是显示"豪"中标

SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = 'RFQ-1764574989800');

-- 1. 检查"模玩兽100元福袋"商品的中标状态
SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    COUNT(DISTINCT qi.id) as quote_count
FROM rfq_items ri
LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%模玩兽100元福袋%'
GROUP BY ri.id, ri.productName, ri.item_status, ri.instant_price;

-- 2. 检查所有报价的状态
SELECT 
    u.username as supplier_name,
    q.id as quote_id,
    q.status as quote_status,
    q.price as quote_price,
    COUNT(DISTINCT qi.id) as quote_items_count,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' THEN qi.id END) as awarded_items_count
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId
LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE q.rfqId = @rfq_id
GROUP BY u.username, q.id, q.status, q.price
ORDER BY u.username;

-- 3. 检查"模玩兽100元福袋"的具体报价和中标情况
SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    u.username as supplier_name,
    qi.id as quote_item_id,
    qi.price,
    q.id as quote_id,
    q.status as quote_status,
    q.submittedAt,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '✅ 满足一口价'
        ELSE '❌ 不满足一口价'
    END as instant_price_check,
    CASE 
        WHEN ri.item_status = 'AWARDED' AND q.status = 'AWARDED' THEN '✅ 已中标'
        WHEN ri.item_status = 'AWARDED' AND q.status != 'AWARDED' THEN '⚠️ 商品已中标但报价状态不对'
        WHEN ri.item_status != 'AWARDED' AND q.status = 'AWARDED' THEN '⚠️ 报价状态已中标但商品未中标'
        ELSE '❌ 未中标'
    END as award_status_check
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%模玩兽100元福袋%'
ORDER BY 
    ri.id,
    CASE WHEN qi.price <= ri.instant_price THEN 0 ELSE 1 END,
    q.submittedAt ASC;

-- 4. 检查 Award 记录
SELECT 
    a.id as award_id,
    u.username as supplier_name,
    a.finalPrice,
    a.status as award_status,
    q.status as quote_status,
    COUNT(DISTINCT qi.id) as quote_items_count,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' THEN qi.id END) as awarded_items_count
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId
LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
GROUP BY a.id, u.username, a.finalPrice, a.status, q.status
ORDER BY u.username;

-- 5. 检查哪个供应商真正中标了"模玩兽100元福袋"
SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    u.username as awarded_supplier,
    qi.price as awarded_price,
    q.id as quote_id,
    q.status as quote_status,
    a.id as award_id,
    CASE 
        WHEN qi.price <= ri.instant_price THEN '✅ 正确（满足一口价）'
        ELSE '❌ 错误（不满足一口价）'
    END as validation
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%模玩兽100元福袋%'
  AND ri.item_status = 'AWARDED'
ORDER BY ri.id, q.submittedAt ASC;

