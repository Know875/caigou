-- 修复"可乐"账号的报价状态
-- 将错误设置为 AWARDED 的报价状态改为 SUBMITTED

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
    rfq.title
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
ORDER BY q.submittedAt DESC;

-- 2. 更新"可乐"的报价状态为 SUBMITTED（只更新状态为 AWARDED 的）
UPDATE quotes q
INNER JOIN users u ON q.supplierId = u.id
SET q.status = 'SUBMITTED',
    q.updatedAt = NOW()
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED';

-- 3. 验证更新结果
SELECT 
    q.id,
    q.rfqId,
    u.username,
    q.status,
    q.price,
    rfq.rfqNo,
    rfq.title
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
WHERE u.username = '可乐'
ORDER BY q.submittedAt DESC;

