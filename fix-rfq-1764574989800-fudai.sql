-- 修复 RFQ-1764574989800 的"模玩兽100元福袋（可叠加）"一口价选商错误
-- 问题：一口价是86，但选择了"豪"（89），而不是"可乐"或"赛罗"（都是86）
-- 应该选择最早提交且满足一口价的供应商
-- 
-- 使用方法：
-- 1. 先执行查询部分，查看当前数据
-- 2. 确认数据后，执行修复部分
-- 3. 最后执行验证部分，确认修复结果

SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = 'RFQ-1764574989800');
SET @fudai_instant_price = 86.00;

-- ============================================
-- 第一部分：查看当前数据
-- ============================================

-- 1.1 查看所有"模玩兽100元福袋"商品的报价情况
SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.instantPrice,
    ri.itemStatus,
    qi.id as quote_item_id,
    u.username as supplier_name,
    qi.price,
    q.submittedAt,
    q.status as quote_status,
    CASE 
        WHEN qi.price <= ri.instantPrice THEN '✅ 满足一口价'
        ELSE '❌ 不满足一口价'
    END as instant_price_check
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%模玩兽100元福袋%'
ORDER BY 
    CASE WHEN qi.price <= ri.instantPrice THEN 0 ELSE 1 END, -- 先满足一口价的
    q.submittedAt ASC; -- 然后按提交时间排序

-- 1.2 查看当前的中标情况
SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.itemStatus,
    a.id as award_id,
    u.username as awarded_supplier,
    a.finalPrice,
    a.status as award_status
FROM rfq_items ri
LEFT JOIN awards a ON a.rfqId = ri.rfqId
LEFT JOIN users u ON a.supplierId = u.id
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%模玩兽100元福袋%'
  AND (a.status IS NULL OR a.status != 'CANCELLED');

-- ============================================
-- 第二部分：修复数据（需要根据查询结果确认后执行）
-- ============================================

START TRANSACTION;

-- 2.1 重置所有"模玩兽100元福袋"商品的状态
UPDATE rfq_items 
SET itemStatus = 'QUOTED' 
WHERE rfqId = @rfq_id
  AND productName LIKE '%模玩兽100元福袋%';

-- 2.2 删除"豪"的相关 Award 记录（因为"豪"的报价不满足一口价）
DELETE FROM awards 
WHERE rfqId = @rfq_id
  AND supplierId = (SELECT id FROM users WHERE username = '豪')
  AND status != 'CANCELLED';

-- 2.3 重置"豪"的报价状态和价格
UPDATE quotes 
SET status = 'SUBMITTED', 
    price = (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = quotes.id
          AND ri.productName NOT LIKE '%模玩兽100元福袋%'
          AND ri.itemStatus = 'AWARDED'
    )
WHERE rfqId = @rfq_id
  AND supplierId = (SELECT id FROM users WHERE username = '豪');

-- 2.4 为每个"模玩兽100元福袋"商品，选择最早提交且满足一口价的报价
-- 注意：由于有多个相同的商品，需要为每个商品单独处理
-- 这里使用子查询找到每个商品最早提交且满足一口价的报价

-- 更新商品状态为 AWARDED，并关联正确的报价
UPDATE rfq_items ri
INNER JOIN (
    SELECT 
        ri2.id as rfq_item_id,
        qi2.id as quote_item_id,
        q2.id as quote_id,
        q2.supplierId,
        qi2.price,
        q2.submittedAt,
        ROW_NUMBER() OVER (
            PARTITION BY ri2.id 
            ORDER BY 
                CASE WHEN qi2.price <= ri2.instantPrice THEN 0 ELSE 1 END,
                q2.submittedAt ASC
        ) as rn
    FROM rfq_items ri2
    INNER JOIN quote_items qi2 ON ri2.id = qi2.rfqItemId
    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
    WHERE ri2.rfqId = @rfq_id
      AND ri2.productName LIKE '%模玩兽100元福袋%'
      AND qi2.price <= ri2.instantPrice  -- 只选择满足一口价的
) as best_quotes ON ri.id = best_quotes.rfq_item_id AND best_quotes.rn = 1
SET ri.itemStatus = 'AWARDED';

-- 2.5 更新或创建 Award 记录
-- 对于"可乐"和"赛罗"（满足一口价的供应商）
INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt, awardedAt)
SELECT 
    CONCAT('award-', q.id) as id,
    @rfq_id as rfqId,
    q.id as quoteId,
    q.supplierId,
    (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = q.id
          AND ri.itemStatus = 'AWARDED'
          AND EXISTS (
              SELECT 1 
              FROM awards a2
              WHERE a2.rfqId = @rfq_id
                AND a2.supplierId = q.supplierId
                AND a2.status != 'CANCELLED'
          ) = 0  -- 如果已经有 Award 记录，不重复计算
    ) as finalPrice,
    '修复一口价选商错误：选择最早提交且满足一口价的供应商' as reason,
    'ACTIVE' as status,
    NOW() as createdAt,
    NOW() as updatedAt,
    NOW() as awardedAt
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
WHERE q.rfqId = @rfq_id
  AND u.username IN ('可乐', '赛罗')
  AND EXISTS (
      SELECT 1 
      FROM quote_items qi
      INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
      WHERE qi.quoteId = q.id
        AND ri.productName LIKE '%模玩兽100元福袋%'
        AND qi.price <= ri.instantPrice
        AND ri.itemStatus = 'AWARDED'
  )
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a
      WHERE a.rfqId = @rfq_id
        AND a.supplierId = q.supplierId
        AND a.status != 'CANCELLED'
  )
ON DUPLICATE KEY UPDATE
    finalPrice = (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = q.id
          AND ri.itemStatus = 'AWARDED'
    ),
    updatedAt = NOW();

-- 2.6 更新 quote.status 和 quote.price
UPDATE quotes q
SET 
    status = CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM quote_items qi
            INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
            WHERE qi.quoteId = q.id
              AND ri.itemStatus = 'AWARDED'
        ) THEN 'AWARDED'
        ELSE 'SUBMITTED'
    END,
    price = (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = q.id
          AND ri.itemStatus = 'AWARDED'
    )
WHERE q.rfqId = @rfq_id;

-- 2.7 更新 Award 记录的 finalPrice（重新计算）
UPDATE awards a
INNER JOIN quotes q ON a.quoteId = q.id
SET 
    a.finalPrice = (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = q.id
          AND ri.itemStatus = 'AWARDED'
    ),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED';

-- ============================================
-- 第三部分：验证修复结果
-- ============================================

-- 3.1 检查商品中标情况
SELECT 
    ri.productName,
    ri.itemStatus,
    u.username as awarded_supplier,
    qi.price as awarded_price,
    q.submittedAt,
    CASE 
        WHEN qi.price <= ri.instantPrice THEN '✅ 正确（满足一口价）'
        ELSE '❌ 错误（不满足一口价）'
    END as validation
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
INNER JOIN awards a ON a.rfqId = ri.rfqId AND a.supplierId = q.supplierId
WHERE ri.rfqId = @rfq_id
  AND ri.productName LIKE '%模玩兽100元福袋%'
  AND ri.itemStatus = 'AWARDED'
  AND a.status != 'CANCELLED'
ORDER BY ri.productName, q.submittedAt;

-- 3.2 检查 quote.status 和 quote.price
SELECT 
    u.username,
    q.status as quote_status,
    q.price as quote_price,
    (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        WHERE qi.quoteId = q.id
          AND ri.itemStatus = 'AWARDED'
    ) as calculated_price,
    CASE 
        WHEN q.price = (
            SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
            FROM quote_items qi
            INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
            WHERE qi.quoteId = q.id
              AND ri.itemStatus = 'AWARDED'
        ) THEN '✅ 一致'
        ELSE '❌ 不一致'
    END as price_validation
FROM quotes q
INNER JOIN users u ON q.supplierId = u.id
WHERE q.rfqId = @rfq_id
ORDER BY u.username;

-- 3.3 检查 Award.finalPrice
SELECT 
    u.username,
    a.finalPrice as award_final_price,
    (
        SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
        FROM quote_items qi
        INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
        INNER JOIN quotes q2 ON qi.quoteId = q2.id
        WHERE q2.supplierId = a.supplierId
          AND ri.rfqId = @rfq_id
          AND ri.itemStatus = 'AWARDED'
    ) as calculated_final_price,
    CASE 
        WHEN a.finalPrice = (
            SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
            FROM quote_items qi
            INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
            INNER JOIN quotes q2 ON qi.quoteId = q2.id
            WHERE q2.supplierId = a.supplierId
              AND ri.rfqId = @rfq_id
              AND ri.itemStatus = 'AWARDED'
        ) THEN '✅ 一致'
        ELSE '❌ 不一致'
    END as final_price_validation
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
ORDER BY u.username;

-- 如果验证通过，执行 COMMIT;
-- 如果需要回滚，执行 ROLLBACK;
-- COMMIT;
-- ROLLBACK;
