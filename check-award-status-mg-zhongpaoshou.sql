-- 快速检查 MG重炮手 的 Award 状态
SET @rfq_item_id = 'cmipi6gwf000lkq9fvbu8t5ng' COLLATE utf8mb4_unicode_ci;

SELECT '=== 当前 Award 状态（包含 MG重炮手） ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products,
    GROUP_CONCAT(DISTINCT CONCAT(ri.productName, ':', qi.price) ORDER BY ri.productName SEPARATOR '; ') AS products_with_prices
FROM awards a
JOIN quotes q ON a.quoteId = q.id
JOIN users u ON q.supplierId = u.id
JOIN quote_items qi ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = (SELECT rfqId FROM rfq_items WHERE id COLLATE utf8mb4_unicode_ci = @rfq_item_id)
  AND a.status != 'CANCELLED'
  AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = @rfq_item_id
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason
ORDER BY a.finalPrice ASC;

SELECT '=== 所有供应商对 MG重炮手 的报价 ===' AS section;

SELECT 
    u.username AS supplier_name,
    qi.price,
    q.submittedAt,
    CASE 
        WHEN EXISTS (
            SELECT 1 FROM awards a2 
            JOIN quote_items qi2 ON qi2.quoteId = a2.quoteId
            WHERE a2.rfqId = (SELECT rfqId FROM rfq_items WHERE id COLLATE utf8mb4_unicode_ci = @rfq_item_id)
              AND a2.status != 'CANCELLED'
              AND qi2.id = qi.id
              AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = @rfq_item_id
        ) THEN '✅ 有Award'
        ELSE '❌ 无Award'
    END AS has_award
FROM quote_items qi
JOIN quotes q ON qi.quoteId = q.id
JOIN users u ON q.supplierId = u.id
WHERE qi.rfqItemId COLLATE utf8mb4_unicode_ci = @rfq_item_id
ORDER BY qi.price ASC, q.submittedAt ASC;

