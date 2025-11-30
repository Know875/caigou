-- 安全版本：修复"可乐"账号的报价状态（带事务和回滚）
-- 将错误设置为 AWARDED 的报价状态改为 SUBMITTED

START TRANSACTION;

-- 1. 先查看"可乐"的报价状态（用于确认）
SELECT 
    q.id,
    q.rfqId,
    u.username,
    u.email,
    q.status,
    q.price,
    q.submittedAt,
    rfq.rfqNo,
    rfq.title,
    COUNT(DISTINCT a.id) as award_count
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
GROUP BY q.id, q.rfqId, u.username, u.email, q.status, q.price, q.submittedAt, rfq.rfqNo, rfq.title
ORDER BY q.submittedAt DESC;

-- 2. 更新"可乐"的报价状态为 SUBMITTED（只更新状态为 AWARDED 且没有有效 Award 记录的）
-- 注意：如果该报价有有效的 Award 记录，说明确实中标了，不应该更新
UPDATE quotes q
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
SET q.status = 'SUBMITTED',
    q.updatedAt = NOW()
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
  AND a.id IS NULL;  -- 只更新没有有效 Award 记录的报价

-- 3. 查看更新影响的行数
SELECT ROW_COUNT() as updated_rows;

-- 4. 验证更新结果
SELECT 
    q.id,
    q.rfqId,
    u.username,
    q.status,
    q.price,
    rfq.rfqNo,
    rfq.title,
    CASE WHEN a.id IS NOT NULL THEN '有Award记录' ELSE '无Award记录' END as award_status
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE u.username = '可乐'
ORDER BY q.submittedAt DESC;

-- 如果确认无误，执行 COMMIT;
-- 如果需要回滚，执行 ROLLBACK;
-- COMMIT;
-- ROLLBACK;

