-- 修复"可乐"错误中标的问题
-- 删除"可乐"的错误 Award 记录，并将报价状态改为 SUBMITTED

START TRANSACTION;

-- 1. 查看当前状态
SELECT 
    '当前状态' as step,
    a.id as award_id,
    a.supplierId,
    u.username,
    a.finalPrice,
    a.reason,
    qi.rfqItemId,
    ri.productName,
    qi.price as quote_price
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.id = 'cmilfxy8i0086kqz7os8zyww1';

-- 2. 查看"豪"的报价情况（应该中标的）
SELECT 
    '应该中标的供应商' as step,
    q.id as quote_id,
    u.username,
    qi.rfqItemId,
    ri.productName,
    qi.price,
    ri.item_status
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE ri.id = 'cmilbnu6j005fkqz74c187ktx'
  AND qi.price = (SELECT MIN(qi2.price) FROM quote_items qi2 WHERE qi2.rfqItemId = ri.id);

-- 3. 删除"可乐"的错误 Award 记录
DELETE FROM awards 
WHERE id = 'cmilfxy8i0086kqz7os8zyww1';

SELECT ROW_COUNT() as deleted_awards;

-- 4. 将"可乐"的报价状态改为 SUBMITTED
UPDATE quotes 
SET status = 'SUBMITTED',
    updatedAt = NOW()
WHERE id = 'cmilc02x20072kqz7k54mbjby';

SELECT ROW_COUNT() as updated_quotes;

-- 5. 检查"豪"是否已经有该商品的 Award 记录
SELECT 
    '豪的Award记录' as step,
    a.id,
    a.rfqId,
    a.quoteId,
    a.supplierId,
    u.username,
    a.finalPrice,
    a.reason
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
WHERE a.supplierId = 'cmigt03fg0000kq0jnqo4h92x'  -- 豪的ID
  AND qi.rfqItemId = 'cmilbnu6j005fkqz74c187ktx'  -- MG艾比安的ID
  AND a.status != 'CANCELLED';

-- 6. 验证修复结果
SELECT 
    '修复后状态' as step,
    q.id as quote_id,
    u.username,
    q.status,
    rfq.rfqNo,
    CASE WHEN a.id IS NOT NULL THEN '有Award记录' ELSE '无Award记录' END as award_status
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE q.id = 'cmilc02x20072kqz7k54mbjby';

-- 如果确认无误，执行 COMMIT;
-- 如果需要回滚，执行 ROLLBACK;
-- COMMIT;
-- ROLLBACK;

