-- 检查"可乐"的 Award 记录对应的商品是否真的由"可乐"中标（修正版）

-- 1. 查看"可乐"的 Award 记录对应的商品
SELECT 
    a.id as award_id,
    a.supplierId as award_supplier_id,
    a_user.username as award_supplier_name,
    qi.rfqItemId,
    ri.productName,
    qi.price as quote_price,
    ri.item_status
FROM awards a
INNER JOIN users a_user ON a.supplierId = a_user.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.id = 'cmilfxy8i0086kqz7os8zyww1';

-- 2. 查看该商品的所有报价，确认最低价供应商
SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    qi.id as quote_item_id,
    q.id as quote_id,
    u.username,
    qi.price,
    CASE 
        WHEN qi.price = (SELECT MIN(qi2.price) 
                         FROM quote_items qi2 
                         WHERE qi2.rfqItemId = ri.id) 
        THEN '最低价（应该中标）'
        ELSE ''
    END as should_award
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE ri.id IN (
    SELECT qi2.rfqItemId 
    FROM quote_items qi2 
    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
    WHERE q2.id = 'cmilc02x20072kqz7k54mbjby'
)
ORDER BY ri.productName, qi.price ASC;

-- 3. 查看该询价单的所有商品和对应的中标情况
SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.maxPrice,
    ri.instantPrice,
    -- 最低价报价
    (SELECT MIN(qi.price) 
     FROM quote_items qi 
     WHERE qi.rfqItemId = ri.id) as min_price,
    -- 最低价供应商
    (SELECT u.username 
     FROM quote_items qi 
     INNER JOIN quotes q ON qi.quoteId = q.id
     INNER JOIN users u ON q.supplierId = u.id
     WHERE qi.rfqItemId = ri.id 
     ORDER BY qi.price ASC 
     LIMIT 1) as min_price_supplier,
    -- Award 记录中的供应商
    (SELECT a_user.username 
     FROM awards a
     INNER JOIN quotes a_q ON a.quoteId = a_q.id
     INNER JOIN quote_items a_qi ON a_q.id = a_qi.quoteId
     INNER JOIN users a_user ON a.supplierId = a_user.id
     WHERE a_qi.rfqItemId = ri.id 
       AND a.status != 'CANCELLED'
     LIMIT 1) as award_supplier
FROM rfq_items ri
WHERE ri.rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
ORDER BY ri.productName;

