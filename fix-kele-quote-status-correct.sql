-- 修复"可乐"账号的报价状态（正确版本）
-- 检查 Award 记录的 supplierId 是否与报价的 supplierId 匹配

START TRANSACTION;

-- 1. 查看"可乐"的报价和对应的 Award 记录详情
SELECT 
    q.id as quote_id,
    q.rfqId,
    q.supplierId as quote_supplier_id,
    u.username,
    u.email,
    q.status,
    q.price,
    rfq.rfqNo,
    rfq.title,
    a.id as award_id,
    a.supplierId as award_supplier_id,
    a.status as award_status,
    CASE 
        WHEN a.id IS NULL THEN '无Award记录'
        WHEN a.supplierId = q.supplierId THEN 'Award属于该报价供应商（正确）'
        ELSE 'Award不属于该报价供应商（错误）'
    END as award_check
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN rfqs rfq ON q.rfqId = rfq.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
ORDER BY q.submittedAt DESC;

-- 2. 更新"可乐"的报价状态为 SUBMITTED
-- 只更新：状态为 AWARDED 且（没有 Award 记录 或 Award 记录的 supplierId 不匹配）
UPDATE quotes q
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
SET q.status = 'SUBMITTED',
    q.updatedAt = NOW()
WHERE u.username = '可乐' 
  AND q.status = 'AWARDED'
  AND (a.id IS NULL OR a.supplierId != q.supplierId);  -- 修改：检查 supplierId 是否匹配

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
    CASE 
        WHEN a.id IS NULL THEN '无Award记录'
        WHEN a.supplierId = q.supplierId THEN 'Award属于该报价供应商'
        ELSE 'Award不属于该报价供应商'
    END as award_check
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

