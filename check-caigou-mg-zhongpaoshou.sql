-- 检查菜狗对 MG重炮手 的报价和中标情况
SET @rfq_item_id = 'cmipi6gwf000lkq9fvbu8t5ng';
SET @supplier_name = '菜狗';

SELECT '=== MG重炮手 基本信息 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    ri.max_price,
    ri.trackingNo,
    ri.carrier
FROM rfq_items ri
WHERE ri.id = @rfq_item_id;

SELECT '=== 所有供应商对 MG重炮手 的报价 ===' AS section;

SELECT 
    qi.id AS quote_item_id,
    q.id AS quote_id,
    u.username AS supplier_name,
    u.id AS supplier_id,
    qi.price,
    q.submittedAt,
    q.status AS quote_status
FROM quote_items qi
JOIN quotes q ON qi.quoteId = q.id
JOIN users u ON q.supplierId = u.id
WHERE qi.rfqItemId = @rfq_item_id
ORDER BY qi.price ASC, q.submittedAt ASC;

SELECT '=== 所有 Award 记录（包含 MG重炮手） ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    a.cancellation_reason,
    a.createdAt,
    a.cancelled_at,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
JOIN quotes q ON a.quoteId = q.id
JOIN users u ON q.supplierId = u.id
JOIN quote_items qi ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = (SELECT rfqId FROM rfq_items WHERE id = @rfq_item_id)
  AND a.status != 'CANCELLED'
  AND qi.rfqItemId = @rfq_item_id
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason, a.cancellation_reason, a.createdAt, a.cancelled_at;

SELECT '=== 菜狗的所有报价（包含 MG重炮手） ===' AS section;

SELECT 
    q.id AS quote_id,
    q.status AS quote_status,
    q.price AS quote_total_price,
    q.submittedAt,
    COUNT(qi.id) AS item_count,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM quotes q
JOIN quote_items qi ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
JOIN users u ON q.supplierId = u.id
WHERE u.username = @supplier_name
  AND q.rfqId = (SELECT rfqId FROM rfq_items WHERE id = @rfq_item_id)
GROUP BY q.id, q.status, q.price, q.submittedAt;

SELECT '=== 菜狗对 MG重炮手 的具体报价项 ===' AS section;

SELECT 
    qi.id AS quote_item_id,
    q.id AS quote_id,
    qi.price,
    q.submittedAt,
    ri.productName,
    ri.item_status
FROM quote_items qi
JOIN quotes q ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
JOIN users u ON q.supplierId = u.id
WHERE u.username = @supplier_name
  AND qi.rfqItemId = @rfq_item_id;

SELECT '=== 菜狗的 Award 记录（包含 MG重炮手） ===' AS section;

SELECT 
    a.id AS award_id,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products,
    GROUP_CONCAT(DISTINCT qi.id ORDER BY qi.id SEPARATOR ', ') AS quote_item_ids
FROM awards a
JOIN quotes q ON a.quoteId = q.id
JOIN users u ON q.supplierId = u.id
JOIN quote_items qi ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE u.username = @supplier_name
  AND a.rfqId = (SELECT rfqId FROM rfq_items WHERE id = @rfq_item_id)
  AND a.status != 'CANCELLED'
  AND qi.rfqItemId = @rfq_item_id
GROUP BY a.id, a.status, a.finalPrice, a.reason;

