-- 修复错误的 Award 记录：从胡先生的 Award 中移除 MG重炮手
-- MG重炮手应该只属于菜狗（价格 160 < 162）

SET @rfq_item_id = 'cmipi6gwf000lkq9fvbu8t5ng' COLLATE utf8mb4_unicode_ci;
SET @rfq_id = (SELECT rfqId FROM rfq_items WHERE id COLLATE utf8mb4_unicode_ci = @rfq_item_id);

SELECT '=== 修复前的 Award 记录 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products,
    GROUP_CONCAT(DISTINCT qi.id ORDER BY qi.id SEPARATOR ', ') AS quote_item_ids
FROM awards a
JOIN quotes q ON a.quoteId = q.id
JOIN users u ON q.supplierId = u.id
JOIN quote_items qi ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
  AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = @rfq_item_id
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason;

-- 开始事务
START TRANSACTION;

-- 1. 找到胡先生的 Award（包含 MG重炮手）
SET @hu_award_id = (
    SELECT a.id
    FROM awards a
    JOIN quotes q ON a.quoteId = q.id
    JOIN users u ON q.supplierId = u.id
    JOIN quote_items qi ON qi.quoteId = q.id
    WHERE a.rfqId = @rfq_id
      AND a.status != 'CANCELLED'
      AND u.username COLLATE utf8mb4_unicode_ci = '胡先生'
      AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = @rfq_item_id
    LIMIT 1
);

SELECT CONCAT('胡先生的 Award ID: ', @hu_award_id) AS message;

-- 2. 找到胡先生对 MG重炮手的报价项
SET @hu_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    JOIN quotes q ON qi.quoteId = q.id
    JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId COLLATE utf8mb4_unicode_ci = @rfq_item_id
      AND u.username COLLATE utf8mb4_unicode_ci = '胡先生'
    LIMIT 1
);

SELECT CONCAT('胡先生对 MG重炮手的报价项 ID: ', @hu_quote_item_id) AS message;

-- 3. 计算移除 MG重炮手后的新价格（如果胡先生的 Award 存在）
SET @new_final_price = (
    SELECT COALESCE(SUM(qi.price), 0)
    FROM quote_items qi
    WHERE qi.quoteId = (SELECT quoteId FROM awards WHERE id = @hu_award_id)
      AND qi.id != @hu_quote_item_id
);

SELECT CONCAT('移除 MG重炮手后的新价格: ', @new_final_price) AS message;

-- 4. 更新胡先生的 Award 的 finalPrice 和 reason（如果 Award 存在）
UPDATE awards
SET finalPrice = (
    SELECT COALESCE(SUM(qi.price), 0)
    FROM quote_items qi
    WHERE qi.quoteId = awards.quoteId
      AND qi.id != @hu_quote_item_id
),
reason = CONCAT(COALESCE(reason, ''), '；已移除商品：MG重炮手（错误中标，应由菜狗中标）')
WHERE id = @hu_award_id
  AND @hu_award_id IS NOT NULL
  AND @hu_quote_item_id IS NOT NULL;

SELECT CONCAT('已更新胡先生的 Award，新价格: ', @new_final_price) AS message;

-- 5. 验证菜狗的 Award 是否正确包含 MG重炮手
SELECT '=== 验证菜狗的 Award ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
JOIN quotes q ON a.quoteId = q.id
JOIN users u ON q.supplierId = u.id
JOIN quote_items qi ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
  AND u.username COLLATE utf8mb4_unicode_ci = '菜狗'
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason;

-- 6. 显示修复后的所有 Award 记录
SELECT '=== 修复后的 Award 记录（包含 MG重炮手） ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
JOIN quotes q ON a.quoteId = q.id
JOIN users u ON q.supplierId = u.id
JOIN quote_items qi ON qi.quoteId = q.id
JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
  AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = @rfq_item_id
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason;

-- 提交事务
COMMIT;

SELECT '=== 修复完成 ===' AS section;

