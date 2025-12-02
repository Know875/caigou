-- 修复历史数据：确保每个已中标商品的中标供应商正确
-- 问题：当 RFQ 有多个商品且不同供应商中标时，Award 记录可能不正确
-- 导致供应商端显示错误的中标供应商
-- 
-- 使用方法：
-- 1. 先执行查询部分，查看需要修复的数据
-- 2. 确认数据后，执行修复部分
-- 3. 最后执行验证部分，确认修复结果

-- ============================================
-- 第一部分：查询需要修复的数据
-- ============================================

-- 1.1 查找所有可能有问题的 RFQ（有多个 Award 记录，且商品已中标）
SELECT 
    r.rfqNo,
    r.id as rfq_id,
    r.title,
    COUNT(DISTINCT a.id) as award_count,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' THEN ri.id END) as awarded_item_count
FROM rfqs r
INNER JOIN awards a ON a.rfqId = r.id AND a.status != 'CANCELLED'
INNER JOIN rfq_items ri ON ri.rfqId = r.id
WHERE ri.item_status = 'AWARDED'
GROUP BY r.id, r.rfqNo, r.title
HAVING COUNT(DISTINCT a.id) > 1  -- 有多个 Award 记录
ORDER BY r.rfqNo;

-- 1.2 对于每个已中标的商品，检查中标供应商是否正确
-- 方法：通过 Award 记录和 quoteItems 的匹配关系来确定
SELECT 
    r.rfqNo,
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    u_correct.username as correct_supplier,
    qi_correct.id as correct_quote_item_id,
    qi_correct.price as correct_price,
    a_correct.id as correct_award_id,
    u_wrong.username as wrong_supplier,
    qi_wrong.id as wrong_quote_item_id,
    qi_wrong.price as wrong_price,
    a_wrong.id as wrong_award_id,
    CASE 
        WHEN a_correct.id IS NOT NULL AND a_correct.quoteId = qi_correct.quoteId THEN '✅ 正确'
        WHEN a_wrong.id IS NOT NULL AND a_wrong.quoteId = qi_wrong.quoteId THEN '❌ 错误：Award 记录指向错误的供应商'
        ELSE '⚠️ 需要检查'
    END as status_check
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
-- 找到真正中标的报价项（通过 Award 记录）
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id as quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        a.id as award_id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON qi.rfqItemId = ri2.id
    WHERE ri2.item_status = 'AWARDED'
    -- 验证该 Award 对应的 quote 中确实包含该报价项
    AND EXISTS (
        SELECT 1 
        FROM quote_items qi2 
        WHERE qi2.quoteId = a.quoteId 
        AND qi2.rfqItemId = qi.rfqItemId
        AND qi2.id = qi.id
    )
) as correct_award ON correct_award.rfqItemId = ri.id
LEFT JOIN users u_correct ON correct_award.supplierId = u_correct.id
LEFT JOIN quote_items qi_correct ON correct_award.quote_item_id = qi_correct.id
LEFT JOIN awards a_correct ON correct_award.award_id = a_correct.id
-- 找到可能错误的报价项（价格最低但不是真正中标的）
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id as quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        a.id as award_id,
        ROW_NUMBER() OVER (PARTITION BY qi.rfqItemId ORDER BY qi.price ASC, q.submittedAt ASC) as rn
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON qi.rfqItemId = ri2.id
    WHERE ri2.item_status = 'AWARDED'
) as wrong_award ON wrong_award.rfqItemId = ri.id AND wrong_award.rn = 1
LEFT JOIN users u_wrong ON wrong_award.supplierId = u_wrong.id
LEFT JOIN quote_items qi_wrong ON wrong_award.quote_item_id = qi_wrong.id
LEFT JOIN awards a_wrong ON wrong_award.award_id = a_wrong.id
WHERE ri.item_status = 'AWARDED'
  AND (correct_award.supplierId != wrong_award.supplierId OR correct_award.supplierId IS NULL)
ORDER BY r.rfqNo, ri.productName;

-- 1.3 检查特定 RFQ 的数据（RFQ-1764574989800）
SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

SELECT 
    '=== RFQ 基本信息 ===' as section;
    
SELECT 
    r.rfqNo,
    r.title,
    r.status as rfq_status,
    COUNT(DISTINCT a.id) as award_count,
    COUNT(DISTINCT ri.id) as total_items,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' THEN ri.id END) as awarded_items
FROM rfqs r
LEFT JOIN awards a ON a.rfqId = r.id AND a.status != 'CANCELLED'
LEFT JOIN rfq_items ri ON ri.rfqId = r.id
WHERE r.id = @rfq_id
GROUP BY r.id, r.rfqNo, r.title, r.status;

SELECT 
    '=== 已中标商品的中标情况 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.instant_price,
    u.username as supplier_name,
    qi.id as quote_item_id,
    qi.price,
    q.id as quote_id,
    q.status as quote_status,
    a.id as award_id,
    a.status as award_status,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = q.id THEN '✅ 有 Award 记录'
        WHEN a.id IS NULL THEN '⚠️ 没有 Award 记录'
        ELSE '❌ Award 记录不匹配'
    END as award_check
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName, qi.price ASC, q.submittedAt ASC;

-- ============================================
-- 第二部分：修复数据（需要根据查询结果确认后执行）
-- ============================================

-- ⚠️ 注意：以下修复脚本需要根据实际查询结果进行调整
-- 建议先执行查询部分，确认需要修复的数据后再执行修复

START TRANSACTION;

-- 2.1 对于每个已中标的商品，确保 Award 记录正确
-- 方法：找到真正中标的报价项，然后确保对应的 Award 记录存在且正确

-- 首先，我们需要为每个已中标的商品找到真正中标的供应商
-- 真正中标的供应商应该是：存在 Award 记录，且 Award.quoteId = quoteItem.quoteId，且 Award.quote.items 中包含该 quoteItem

-- 创建临时表存储需要修复的数据
CREATE TEMPORARY TABLE IF NOT EXISTS temp_award_fixes (
    rfq_id VARCHAR(255),
    rfq_item_id VARCHAR(255),
    correct_quote_item_id VARCHAR(255),
    correct_quote_id VARCHAR(255),
    correct_supplier_id VARCHAR(255),
    correct_price DECIMAL(10, 2),
    existing_award_id VARCHAR(255),
    action VARCHAR(50) -- 'CREATE', 'UPDATE', 'DELETE'
);

-- 插入需要修复的数据
INSERT INTO temp_award_fixes (rfq_id, rfq_item_id, correct_quote_item_id, correct_quote_id, correct_supplier_id, correct_price, existing_award_id, action)
SELECT 
    ri.rfqId,
    ri.id as rfq_item_id,
    qi.id as correct_quote_item_id,
    q.id as correct_quote_id,
    q.supplierId as correct_supplier_id,
    qi.price as correct_price,
    a.id as existing_award_id,
    CASE 
        WHEN a.id IS NULL THEN 'CREATE'
        WHEN a.quoteId != q.id THEN 'UPDATE'
        ELSE 'SKIP'
    END as action
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.item_status = 'AWARDED'
  AND EXISTS (
      -- 验证该报价项确实有对应的 Award 记录，且 Award.quote.items 中包含该报价项
      SELECT 1 
      FROM awards a2
      INNER JOIN quotes q2 ON a2.quoteId = q2.id
      INNER JOIN quote_items qi2 ON qi2.quoteId = q2.id
      WHERE a2.rfqId = ri.rfqId
        AND a2.supplierId = q.supplierId
        AND a2.status != 'CANCELLED'
        AND qi2.rfqItemId = ri.id
        AND qi2.id = qi.id
  )
  AND (
      -- 需要修复的情况：没有 Award 记录，或者 Award 记录不匹配
      a.id IS NULL 
      OR a.quoteId != q.id
  )
GROUP BY ri.rfqId, ri.id, qi.id, q.id, q.supplierId, qi.price, a.id;

-- 2.2 删除错误的 Award 记录（如果 Award 记录指向错误的 quote）
-- 注意：这里只删除明显错误的记录，需要谨慎操作
-- DELETE FROM awards 
-- WHERE id IN (
--     SELECT existing_award_id 
--     FROM temp_award_fixes 
--     WHERE action = 'UPDATE' AND existing_award_id IS NOT NULL
-- );

-- 2.3 创建缺失的 Award 记录
INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt, awardedAt)
SELECT 
    CONCAT('award-', correct_quote_id, '-', UNIX_TIMESTAMP()) as id,
    rfq_id,
    correct_quote_id,
    correct_supplier_id,
    correct_price,
    '修复历史数据：确保 Award 记录正确对应中标供应商' as reason,
    'ACTIVE' as status,
    NOW() as createdAt,
    NOW() as updatedAt,
    NOW() as awardedAt
FROM temp_award_fixes
WHERE action = 'CREATE'
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a 
      WHERE a.rfqId = temp_award_fixes.rfq_id 
        AND a.supplierId = temp_award_fixes.correct_supplier_id 
        AND a.status != 'CANCELLED'
  );

-- 2.4 更新错误的 Award 记录
UPDATE awards a
INNER JOIN temp_award_fixes t ON a.id = t.existing_award_id
SET 
    a.quoteId = t.correct_quote_id,
    a.supplierId = t.correct_supplier_id,
    a.finalPrice = (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = t.correct_quote_id
          AND ri.item_status = 'AWARDED'
    ),
    a.updatedAt = NOW()
WHERE t.action = 'UPDATE';

-- 2.5 更新 Award 记录的 finalPrice（重新计算所有 Award 记录的总价）
UPDATE awards a
INNER JOIN quotes q ON a.quoteId = q.id
SET 
    a.finalPrice = (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = q.id
          AND ri.item_status = 'AWARDED'
          AND EXISTS (
              SELECT 1 
              FROM awards a2
              WHERE a2.rfqId = a.rfqId
                AND a2.supplierId = a.supplierId
                AND a2.status != 'CANCELLED'
                AND a2.quoteId = q.id
          )
    ),
    a.updatedAt = NOW()
WHERE a.status != 'CANCELLED';

-- 清理临时表
DROP TEMPORARY TABLE IF EXISTS temp_award_fixes;

-- ============================================
-- 第三部分：验证修复结果
-- ============================================

-- 3.1 验证修复后的数据
SELECT 
    '=== 修复后的 Award 记录 ===' as section;

SELECT 
    r.rfqNo,
    ri.id as rfq_item_id,
    ri.productName,
    u.username as supplier_name,
    qi.price,
    a.id as award_id,
    a.quoteId,
    a.status as award_status,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 仍有问题'
    END as validation
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.item_status = 'AWARDED'
  AND EXISTS (
      SELECT 1 
      FROM quote_items qi2 
      WHERE qi2.quoteId = a.quoteId 
      AND qi2.rfqItemId = ri.id
      AND qi2.id = qi.id
  )
ORDER BY r.rfqNo, ri.productName;

-- 3.2 检查特定 RFQ 的修复结果
SELECT 
    '=== RFQ-1764574989800 修复结果 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    u.username as supplier_name,
    qi.price,
    a.id as award_id,
    a.status as award_status,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 仍有问题'
    END as validation
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName, qi.price ASC;

-- 如果验证通过，执行 COMMIT;
-- 如果需要回滚，执行 ROLLBACK;
-- COMMIT;
-- ROLLBACK;

