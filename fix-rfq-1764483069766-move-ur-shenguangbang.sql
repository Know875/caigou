-- 修复脚本：将 RFQ-1764483069766 中的 UR神光棒 从赛罗移动到豪
-- 注意：执行前请先运行 check-rfq-1764483069766-ur-shenguangbang.sql 查看数据

SET @rfq_no = 'RFQ-1764483069766';
SET @product_name = 'UR神光棒';
SET @supplier_from = '赛罗';
SET @supplier_to = '豪';

-- 设置变量
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);
SET @rfq_item_id = (SELECT ri.id FROM rfq_items ri WHERE ri.rfqId = @rfq_id AND ri.productName LIKE '%UR神光棒%' LIMIT 1);
SET @supplier_from_id = (SELECT id FROM users WHERE username COLLATE utf8mb4_unicode_ci = @supplier_from COLLATE utf8mb4_unicode_ci LIMIT 1);
SET @supplier_to_id = (SELECT id FROM users WHERE username COLLATE utf8mb4_unicode_ci = @supplier_to COLLATE utf8mb4_unicode_ci LIMIT 1);

-- 检查变量是否设置成功
SELECT '=== 变量设置 ===' AS section;
SELECT 
    @rfq_id AS rfq_id,
    @rfq_item_id AS rfq_item_id,
    @supplier_from_id AS supplier_from_id,
    @supplier_to_id AS supplier_to_id;

-- 查找赛罗的 Quote 和 Award
SET @quote_from_id = (
    SELECT q.id 
    FROM quotes q
    INNER JOIN users u ON q.supplierId = u.id
    WHERE q.rfqId = @rfq_id
      AND u.username COLLATE utf8mb4_unicode_ci = @supplier_from COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

SET @award_from_id = (
    SELECT a.id
    FROM awards a
    WHERE a.rfqId = @rfq_id
      AND a.supplierId = @supplier_from_id
      AND a.status != 'CANCELLED'
    LIMIT 1
);

-- 查找豪的 Quote（如果存在）
SET @quote_to_id = (
    SELECT q.id 
    FROM quotes q
    INNER JOIN users u ON q.supplierId = u.id
    WHERE q.rfqId = @rfq_id
      AND u.username COLLATE utf8mb4_unicode_ci = @supplier_to COLLATE utf8mb4_unicode_ci
    LIMIT 1
);

-- 查找豪对 UR神光棒 的报价项
SET @quote_item_to_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    WHERE q.rfqId = @rfq_id
      AND qi.rfqItemId = @rfq_item_id
      AND q.supplierId = @supplier_to_id
    LIMIT 1
);

-- 检查数据
SELECT '=== 检查数据 ===' AS section;
SELECT 
    @quote_from_id AS quote_from_id,
    @award_from_id AS award_from_id,
    @quote_to_id AS quote_to_id,
    @quote_item_to_id AS quote_item_to_id;

-- 检查赛罗的 Quote 包含多少个商品
SELECT '=== 赛罗的 Quote 包含的商品数量 ===' AS section;
SELECT 
    COUNT(*) AS item_count,
    GROUP_CONCAT(ri.productName) AS products
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE q.id = @quote_from_id;

-- ============================================
-- 开始修复
-- ============================================

SET autocommit = 0;
START TRANSACTION;

-- 1. 如果豪没有 Quote，需要先创建（但通常应该已经有了，因为豪已经有MG艾比安的中标）
-- 这里假设豪已经有 Quote，如果没有，需要手动创建

-- 2. 如果豪没有对 UR神光棒 的报价，需要创建报价项
-- 使用赛罗的价格作为参考（或者需要手动指定价格）
SET @ur_price = (
    SELECT qi.price
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    WHERE qi.rfqItemId = @rfq_item_id
      AND q.supplierId = @supplier_from_id
    LIMIT 1
);

-- 如果豪没有报价项，创建报价项（使用赛罗的价格）
INSERT INTO quote_items (
    id,
    quoteId,
    rfqItemId,
    price,
    deliveryDays,
    createdAt,
    updatedAt
)
SELECT 
    CONCAT('cmi', SUBSTRING(MD5(CONCAT(@quote_to_id, @rfq_item_id, NOW())), 1, 25)),
    @quote_to_id,
    @rfq_item_id,
    @ur_price,
    0,
    NOW(),
    NOW()
WHERE @quote_to_id IS NOT NULL
  AND @quote_item_to_id IS NULL
  AND @ur_price IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM quote_items qi 
      WHERE qi.quoteId = @quote_to_id 
        AND qi.rfqItemId = @rfq_item_id
  );

-- 更新 @quote_item_to_id
SET @quote_item_to_id = (
    SELECT qi.id
    FROM quote_items qi
    WHERE qi.quoteId = @quote_to_id
      AND qi.rfqItemId = @rfq_item_id
    LIMIT 1
);

SELECT 
    CASE 
        WHEN @quote_item_to_id IS NOT NULL THEN CONCAT('豪的报价项 ID: ', @quote_item_to_id, ', 价格: ', @ur_price)
        WHEN @quote_to_id IS NULL THEN '豪没有 Quote，需要手动创建'
        WHEN @ur_price IS NULL THEN '无法获取 UR神光棒 的价格'
        ELSE '豪的报价项创建失败或已存在'
    END AS message;

-- 3. 检查赛罗的 Award 包含哪些商品（除了 UR神光棒）
SELECT '=== 赛罗的 Award 包含的其他商品（除UR神光棒外） ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    qi.id AS quote_item_id,
    qi.price
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE q.id = @quote_from_id
  AND ri.id != @rfq_item_id
  AND ri.item_status = 'AWARDED';

-- 4. 取消赛罗的 Award（如果存在）
-- 注意：如果赛罗的 Award 包含多个商品（如SHF歌查德），取消后需要重新为其他商品创建 Award
UPDATE awards
SET status = 'CANCELLED',
    cancellation_reason = '手动调整：UR神光棒转移到豪',
    cancelled_at = NOW(),
    updatedAt = NOW()
WHERE id = @award_from_id
  AND @award_from_id IS NOT NULL;

SELECT 
    CASE 
        WHEN @award_from_id IS NOT NULL THEN CONCAT('已取消赛罗的 Award: ', @award_from_id)
        ELSE '赛罗没有 Award，无需取消'
    END AS message;

-- 5. 如果赛罗还有其他商品（如SHF歌查德），需要为这些商品重新创建 Award
-- 检查赛罗是否还有其他已中标的商品
SET @other_item_id = (
    SELECT ri.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE q.id = @quote_from_id
      AND ri.id != @rfq_item_id
      AND ri.item_status = 'AWARDED'
    LIMIT 1
);

-- 如果赛罗还有其他商品，重新计算价格并创建 Award
SET @final_price_from = (
    SELECT COALESCE(SUM(qi.price * ri.quantity), 0)
    FROM quote_items qi
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE qi.quoteId = @quote_from_id
      AND ri.id != @rfq_item_id
      AND ri.item_status = 'AWARDED'
);

-- 如果赛罗还有其他商品，更新现有的 Award（因为 quoteId 有唯一约束，不能创建新的）
-- 将状态改回 ACTIVE，并更新价格和原因
UPDATE awards
SET status = 'ACTIVE',
    finalPrice = @final_price_from,
    reason = '手动调整：UR神光棒转移后，为其他商品重新激活Award',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    updatedAt = NOW()
WHERE quoteId = @quote_from_id
  AND @other_item_id IS NOT NULL
  AND @final_price_from > 0;

SELECT 
    CASE 
        WHEN @other_item_id IS NOT NULL AND @final_price_from > 0 THEN 
            CONCAT('已为赛罗的其他商品重新激活 Award，价格: ', @final_price_from)
        ELSE '赛罗没有其他商品，无需更新 Award'
    END AS message;

-- 6. 检查豪是否已经有 Award
SET @award_to_id = (
    SELECT a.id
    FROM awards a
    WHERE a.rfqId = @rfq_id
      AND a.supplierId = @supplier_to_id
      AND a.status != 'CANCELLED'
    LIMIT 1
);

-- 7. 更新豪的 Award（如果已存在）或创建新的 Award
-- 计算豪的 Quote 的总价（所有商品，包括新添加的 UR神光棒）
SET @final_price = (
    SELECT COALESCE(SUM(qi.price * ri.quantity), 0)
    FROM quote_items qi
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE qi.quoteId = @quote_to_id
);

-- 如果豪已经有 Award，更新它（添加 UR神光棒 的价格）
UPDATE awards
SET finalPrice = @final_price,
    reason = CONCAT(COALESCE(reason, ''), '; 手动调整：UR神光棒从赛罗转移'),
    updatedAt = NOW()
WHERE id = @award_to_id
  AND @award_to_id IS NOT NULL
  AND @final_price > 0;

-- 如果豪没有 Award 但有 Quote，创建新的 Award
INSERT INTO awards (
    id,
    rfqId,
    quoteId,
    supplierId,
    finalPrice,
    reason,
    status,
    awardedAt,
    createdAt,
    updatedAt
)
SELECT 
    CONCAT('cmi', SUBSTRING(MD5(CONCAT(@rfq_id, @supplier_to_id, NOW())), 1, 25)),
    @rfq_id,
    @quote_to_id,
    @supplier_to_id,
    @final_price,
    '手动调整：UR神光棒从赛罗转移',
    'ACTIVE',
    NOW(),
    NOW(),
    NOW()
WHERE @award_to_id IS NULL 
  AND @quote_to_id IS NOT NULL
  AND @final_price > 0;

-- 更新 @award_to_id
SET @award_to_id = (
    SELECT a.id
    FROM awards a
    WHERE a.rfqId = @rfq_id
      AND a.supplierId = @supplier_to_id
      AND a.status != 'CANCELLED'
    LIMIT 1
);

SELECT 
    CASE 
        WHEN @award_to_id IS NOT NULL THEN CONCAT('豪的 Award ID: ', @award_to_id, ', 总价: ', @final_price)
        ELSE '豪还没有 Award（可能需要手动创建）'
    END AS message;

-- 8. 更新 RFQ Item 的状态（如果需要）
-- 注意：item_status 应该已经是 AWARDED，这里主要是确保数据一致性

-- 9. 如果有相关的 Shipment 记录，需要更新
-- 检查是否有赛罗上传的 UR神光棒 的 Shipment
UPDATE shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
SET s.supplierId = @supplier_to_id,
    s.updatedAt = NOW()
WHERE ri.id = @rfq_item_id
  AND s.supplierId = @supplier_from_id
  AND s.source = 'SUPPLIER';

-- 检查是否有需要更新的 Shipment
SELECT 
    COUNT(*) AS updated_shipments
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE ri.id = @rfq_item_id
  AND s.supplierId = @supplier_to_id
  AND s.source = 'SUPPLIER';

-- 10. 验证修复结果
SELECT '=== 修复后的数据 ===' AS section;

-- 查看赛罗的 Award（应该已取消）
SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status,
    a.cancellation_reason,
    GROUP_CONCAT(ri.productName) AS products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND u.username COLLATE utf8mb4_unicode_ci = @supplier_from COLLATE utf8mb4_unicode_ci
GROUP BY a.id, u.username, a.status, a.cancellation_reason;

-- 查看豪的 Award
SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status,
    a.finalPrice,
    GROUP_CONCAT(ri.productName) AS products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND u.username COLLATE utf8mb4_unicode_ci = @supplier_to COLLATE utf8mb4_unicode_ci
GROUP BY a.id, u.username, a.status, a.finalPrice;

-- 查看 UR神光棒 的当前状态
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    u.username AS current_supplier,
    qi.price,
    a.status AS award_status
FROM rfq_items ri
LEFT JOIN quote_items qi ON qi.rfqItemId = ri.id
LEFT JOIN quotes q ON qi.quoteId = q.id
LEFT JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
LEFT JOIN users u ON q.supplierId = u.id
WHERE ri.id = @rfq_item_id
  AND a.status != 'CANCELLED'
ORDER BY qi.price ASC
LIMIT 1;

-- 提交事务
-- COMMIT;

-- 如果发现问题，可以回滚：
-- ROLLBACK;

SELECT '=== 修复完成 ===' AS section;
SELECT '请检查上述结果，确认无误后执行 COMMIT; 提交事务' AS notice;

