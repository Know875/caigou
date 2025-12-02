-- 修复 RFQ-1764574989800 的中标供应商显示错误
-- 问题：中标应该是"赛罗"，但在供应商端显示成了"可乐"
-- 原因：Award 记录可能不正确，或者查询逻辑有问题
-- 
-- 使用方法：
-- 1. 先执行查询部分，查看当前数据
-- 2. 确认数据后，执行修复部分
-- 3. 最后执行验证部分，确认修复结果

SET @rfq_no = 'RFQ-1764574989800';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no);

-- ============================================
-- 第一部分：查看当前数据
-- ============================================

-- 1.1 查看 RFQ 基本信息
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

-- 1.2 查看所有已中标商品的中标情况
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
    q.submittedAt,
    a.id as award_id,
    a.quoteId as award_quote_id,
    a.status as award_status,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = q.id THEN '✅ Award 记录正确'
        WHEN a.id IS NULL THEN '⚠️ 没有 Award 记录'
        WHEN a.quoteId != q.id THEN '❌ Award 记录指向错误的 quote'
        ELSE '❓ 需要检查'
    END as award_check
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName, qi.price ASC, q.submittedAt ASC;

-- 1.3 查看所有 Award 记录及其对应的商品
SELECT 
    '=== 所有 Award 记录 ===' as section;

SELECT 
    a.id as award_id,
    u.username as supplier_name,
    a.quoteId,
    a.finalPrice,
    a.status as award_status,
    COUNT(DISTINCT qi.id) as quote_items_count,
    GROUP_CONCAT(DISTINCT ri.productName SEPARATOR ', ') as awarded_products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId
LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id AND ri.item_status = 'AWARDED'
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
GROUP BY a.id, u.username, a.quoteId, a.finalPrice, a.status
ORDER BY u.username;

-- 1.4 检查每个商品真正中标的供应商（通过 Award 记录验证）
SELECT 
    '=== 每个商品真正中标的供应商 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    u.username as correct_supplier,
    qi.id as correct_quote_item_id,
    qi.price,
    q.id as correct_quote_id,
    a.id as award_id,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = q.id THEN '✅ 正确'
        ELSE '❌ 需要修复'
    END as status
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
  -- 验证该 Award 对应的 quote 中确实包含该报价项
  AND EXISTS (
      SELECT 1 
      FROM quote_items qi2 
      WHERE qi2.quoteId = a.quoteId 
      AND qi2.rfqItemId = ri.id
      AND qi2.id = qi.id
  )
ORDER BY ri.productName;

-- ============================================
-- 第二部分：修复数据（需要根据查询结果确认后执行）
-- ============================================

START TRANSACTION;

-- 2.1 对于每个已中标的商品，确保 Award 记录正确
-- 方法：找到真正中标的报价项，然后确保对应的 Award 记录存在且正确

-- 首先，我们需要为每个已中标的商品找到真正中标的供应商
-- 真正中标的供应商应该是：存在 Award 记录，且 Award.quoteId = quoteItem.quoteId，且 Award.quote.items 中包含该 quoteItem

-- 步骤1：删除错误的 Award 记录（如果 Award 记录指向错误的 quote，且该 quote 不包含已中标的商品）
-- 注意：这里只删除明显错误的记录，需要谨慎操作
DELETE a FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
  -- 如果该 Award 对应的 quote 中没有已中标的商品，说明 Award 记录错误
  AND NOT EXISTS (
      SELECT 1 
      FROM quote_items qi
      INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
      WHERE qi.quoteId = q.id
        AND ri.rfqId = @rfq_id
        AND ri.item_status = 'AWARDED'
  );

-- 步骤2：为每个已中标的商品，确保有正确的 Award 记录
-- 对于每个已中标的商品，找到真正中标的报价项，然后创建或更新 Award 记录

INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt, awardedAt)
SELECT 
    CONCAT('award-', q.id, '-', UNIX_TIMESTAMP()) as id,
    @rfq_id as rfqId,
    q.id as quoteId,
    q.supplierId,
    (
        SELECT COALESCE(SUM(qi2.price * COALESCE(ri2.quantity, 1)), 0)
        FROM quote_items qi2
        INNER JOIN rfq_items ri2 ON qi2.rfqItemId = ri2.id
        WHERE qi2.quoteId = q.id
          AND ri2.rfqId = @rfq_id
          AND ri2.item_status = 'AWARDED'
    ) as finalPrice,
    '修复历史数据：确保 Award 记录正确对应中标供应商' as reason,
    'ACTIVE' as status,
    NOW() as createdAt,
    NOW() as updatedAt,
    NOW() as awardedAt
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
  -- 确保该报价项确实有对应的 Award 记录（通过验证 Award.quote.items 中包含该报价项）
  AND EXISTS (
      SELECT 1 
      FROM awards a
      WHERE a.rfqId = @rfq_id
        AND a.supplierId = q.supplierId
        AND a.status != 'CANCELLED'
        AND a.quoteId = q.id
  )
  -- 如果该供应商还没有 Award 记录，则创建
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a2
      WHERE a2.rfqId = @rfq_id
        AND a2.supplierId = q.supplierId
        AND a2.status != 'CANCELLED'
  )
GROUP BY q.id, q.supplierId;

-- 步骤3：更新现有 Award 记录的 finalPrice（重新计算）
UPDATE awards a
INNER JOIN quotes q ON a.quoteId = q.id
SET 
    a.finalPrice = (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = q.id
          AND ri.rfqId = @rfq_id
          AND ri.item_status = 'AWARDED'
          -- 确保该报价项确实有对应的 Award 记录
          AND EXISTS (
              SELECT 1 
              FROM awards a2
              WHERE a2.rfqId = @rfq_id
                AND a2.supplierId = q.supplierId
                AND a2.status != 'CANCELLED'
                AND a2.quoteId = q.id
          )
    ),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED';

-- 步骤4：确保 Award 记录的 quoteId 正确
-- 如果 Award 记录的 quoteId 指向的 quote 不包含已中标的商品，需要更新
UPDATE awards a
INNER JOIN (
    SELECT 
        a2.id as award_id,
        q2.id as correct_quote_id,
        q2.supplierId
    FROM awards a2
    INNER JOIN rfq_items ri ON ri.rfqId = a2.rfqId AND ri.item_status = 'AWARDED'
    INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
    INNER JOIN quotes q2 ON qi.quoteId = q2.id
    WHERE a2.rfqId = @rfq_id
      AND a2.supplierId = q2.supplierId
      AND a2.status != 'CANCELLED'
      -- 验证该报价项确实有对应的 Award 记录
      AND EXISTS (
          SELECT 1 
          FROM awards a3
          WHERE a3.rfqId = @rfq_id
            AND a3.supplierId = q2.supplierId
            AND a3.status != 'CANCELLED'
            AND a3.quoteId = q2.id
      )
    GROUP BY a2.id, q2.id, q2.supplierId
    HAVING COUNT(DISTINCT ri.id) > 0
) as correct_quotes ON a.id = correct_quotes.award_id
SET 
    a.quoteId = correct_quotes.correct_quote_id,
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
  AND a.quoteId != correct_quotes.correct_quote_id;

-- ============================================
-- 第三部分：验证修复结果
-- ============================================

-- 3.1 验证修复后的数据
SELECT 
    '=== 修复后的 Award 记录 ===' as section;

SELECT 
    a.id as award_id,
    u.username as supplier_name,
    a.quoteId,
    a.finalPrice,
    a.status as award_status,
    COUNT(DISTINCT qi.id) as quote_items_count,
    GROUP_CONCAT(DISTINCT ri.productName SEPARATOR ', ') as awarded_products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
LEFT JOIN quote_items qi ON q.id = qi.quoteId
LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id AND ri.item_status = 'AWARDED'
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
GROUP BY a.id, u.username, a.quoteId, a.finalPrice, a.status
ORDER BY u.username;

-- 3.2 检查每个商品的中标供应商是否正确
SELECT 
    '=== 每个商品的中标供应商验证 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    u.username as supplier_name,
    qi.price,
    a.id as award_id,
    a.quoteId,
    CASE 
        WHEN a.id IS NOT NULL AND a.quoteId = qi.quoteId THEN '✅ 正确'
        ELSE '❌ 仍有问题'
    END as validation
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId AND a.status != 'CANCELLED'
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
  -- 验证该 Award 对应的 quote 中确实包含该报价项
  AND EXISTS (
      SELECT 1 
      FROM quote_items qi2 
      WHERE qi2.quoteId = a.quoteId 
      AND qi2.rfqItemId = ri.id
      AND qi2.id = qi.id
  )
ORDER BY ri.productName;

-- 如果验证通过，执行 COMMIT;
-- 如果需要回滚，执行 ROLLBACK;
-- COMMIT;
-- ROLLBACK;

