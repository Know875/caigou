-- 检查 Award 记录的详细信息，确认是否真的应该属于"可乐"

-- 1. 查看该 Award 记录对应的报价和商品
SELECT 
    a.id as award_id,
    a.rfqId,
    a.quoteId,
    a.supplierId as award_supplier_id,
    a_user.username as award_supplier_name,
    a.finalPrice,
    a.status as award_status,
    a.reason,
    q.id as quote_id,
    q.supplierId as quote_supplier_id,
    q_user.username as quote_supplier_name,
    q.status as quote_status,
    rfq.rfqNo,
    rfq.title
FROM awards a
INNER JOIN users a_user ON a.supplierId = a_user.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN users q_user ON q.supplierId = q_user.id
INNER JOIN rfqs rfq ON a.rfqId = rfq.id
WHERE a.id = 'cmilfxy8i0086kqz7os8zyww1';

-- 2. 查看该 Award 对应的报价项和商品
SELECT 
    qi.id as quote_item_id,
    qi.rfqItemId,
    qi.price as quote_price,
    ri.productName,
    ri.itemStatus,
    ri.quantity,
    -- 查找该商品的所有报价，看最低价是谁
    (SELECT MIN(qi2.price) 
     FROM quote_items qi2 
     WHERE qi2.rfqItemId = qi.rfqItemId) as min_price,
    (SELECT qi3.quoteId 
     FROM quote_items qi3 
     WHERE qi3.rfqItemId = qi.rfqItemId 
     ORDER BY qi3.price ASC 
     LIMIT 1) as lowest_quote_id,
    (SELECT u.username 
     FROM quote_items qi3 
     INNER JOIN quotes q3 ON qi3.quoteId = q3.id
     INNER JOIN users u ON q3.supplierId = u.id
     WHERE qi3.rfqItemId = qi.rfqItemId 
     ORDER BY qi3.price ASC 
     LIMIT 1) as lowest_price_supplier
FROM quote_items qi
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE qi.quoteId = 'cmilc02x20072kqz7k54mbjby';

-- 3. 查看该询价单的所有报价，确认最低价供应商
SELECT 
    q.id as quote_id,
    u.username,
    u.id as supplier_id,
    qi.rfqItemId,
    ri.productName,
    qi.price,
    ri.itemStatus,
    CASE 
        WHEN qi.price = (SELECT MIN(qi2.price) 
                         FROM quote_items qi2 
                         WHERE qi2.rfqItemId = qi.rfqItemId) 
        THEN '最低价'
        ELSE ''
    END as is_lowest
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE q.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
ORDER BY ri.productName, qi.price ASC;

-- 4. 查看该询价单的所有 Award 记录
SELECT 
    a.id,
    a.supplierId,
    u.username,
    a.finalPrice,
    a.status,
    a.reason
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
  AND a.status != 'CANCELLED';

