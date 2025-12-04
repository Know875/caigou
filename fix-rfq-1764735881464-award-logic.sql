-- 修复 RFQ-1764735881464 的中标逻辑
-- 问题：同一商品有多个 ACTIVE Award，导致中标错误

SET @rfq_no = 'RFQ-1764735881464';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci);

SET autocommit = 0;
START TRANSACTION;

SELECT '=== 开始修复 ===' AS section;

-- 修复逻辑：对于每个已中标的商品，只保留一个 ACTIVE Award
-- 选择规则：
-- 1. 如果有一口价，优先选择满足一口价且最早提交的报价（Quote状态必须是AWARDED）
-- 2. 如果没有满足一口价的，选择最低价（价格相同时，选择最早提交的）

SELECT '=== 修复每个商品的中标逻辑 ===' AS section;

-- 对于每个已中标的商品，找到正确的中标供应商并取消其他供应商的 Award
-- 使用临时表存储每个商品应该中标的供应商

-- 创建临时表存储每个商品应该中标的供应商
CREATE TEMPORARY TABLE IF NOT EXISTS temp_correct_awards (
    rfq_item_id VARCHAR(255),
    supplier_id VARCHAR(255),
    quote_id VARCHAR(255),
    quote_item_id VARCHAR(255),
    price DECIMAL(10,2),
    reason VARCHAR(255),
    INDEX idx_rfq_item (rfq_item_id),
    INDEX idx_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 清空临时表
TRUNCATE TABLE temp_correct_awards;

-- 为每个已中标的商品找到正确的中标供应商
INSERT INTO temp_correct_awards (rfq_item_id, supplier_id, quote_id, quote_item_id, price, reason)
SELECT 
    ri.id AS rfq_item_id,
    q.supplierId AS supplier_id,
    q.id AS quote_id,
    qi.id AS quote_item_id,
    qi.price,
    CASE 
        WHEN ri.instant_price IS NOT NULL AND qi.price <= ri.instant_price THEN '一口价自动中标'
        ELSE '最低价中标'
    END AS reason
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND ri.item_status = 'AWARDED'
  AND q.status = 'AWARDED'  -- 只考虑 AWARDED 状态的 Quote
  AND qi.price > 0
  AND (
    -- 如果有一口价，选择满足一口价且最早提交的
    (ri.instant_price IS NOT NULL AND qi.price <= ri.instant_price)
    OR
    -- 如果没有一口价或没有满足一口价的，选择最低价
    (ri.instant_price IS NULL OR NOT EXISTS (
        SELECT 1 FROM quote_items qi2
        INNER JOIN quotes q2 ON qi2.quoteId = q2.id
        WHERE qi2.rfqItemId = ri.id
          AND q2.status = 'AWARDED'
          AND qi2.price <= ri.instant_price
    ))
  )
  AND (
    -- 对于一口价：选择满足一口价且最早提交的
    (ri.instant_price IS NOT NULL AND qi.price <= ri.instant_price AND q.submittedAt = (
        SELECT MIN(q3.submittedAt)
        FROM quote_items qi3
        INNER JOIN quotes q3 ON qi3.quoteId = q3.id
        WHERE qi3.rfqItemId = ri.id
          AND q3.status = 'AWARDED'
          AND qi3.price <= ri.instant_price
    ))
    OR
    -- 对于非一口价或没有满足一口价的：选择最低价（价格相同时，选择最早提交的）
    (NOT EXISTS (
        SELECT 1 FROM quote_items qi4
        INNER JOIN quotes q4 ON qi4.quoteId = q4.id
        WHERE qi4.rfqItemId = ri.id
          AND q4.status = 'AWARDED'
          AND (
            (ri.instant_price IS NOT NULL AND qi4.price <= ri.instant_price)
            OR (ri.instant_price IS NULL AND qi4.price < qi.price)
            OR (ri.instant_price IS NULL AND qi4.price = qi.price AND q4.submittedAt < q.submittedAt)
          )
    ))
  );

-- 显示应该中标的供应商
SELECT '=== 应该中标的供应商 ===' AS section;

SELECT 
    ri.productName,
    u.username AS supplier_name,
    tca.price,
    tca.reason
FROM temp_correct_awards tca
INNER JOIN rfq_items ri ON tca.rfq_item_id = ri.id
INNER JOIN users u ON tca.supplier_id = u.id
ORDER BY ri.productName;

-- 取消所有不应该中标的 Award
SELECT '=== 取消错误的 Award ===' AS section;

UPDATE awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
SET a.status = 'CANCELLED',
    a.cancellation_reason = 'AUTO_EVALUATE_REAWARD',
    a.cancelled_at = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status = 'ACTIVE'
  AND qi.rfqItemId IN (SELECT rfq_item_id FROM temp_correct_awards)
  AND NOT EXISTS (
    SELECT 1 FROM temp_correct_awards tca
    WHERE tca.rfq_item_id = qi.rfqItemId
      AND tca.supplier_id = a.supplierId
  );

-- 更新所有 Award 的 finalPrice 和 reason
SELECT '=== 更新 Award 的 finalPrice ===' AS section;

-- 为每个供应商重新计算 finalPrice（只计算正确中标的商品）
UPDATE awards a
INNER JOIN (
    SELECT 
        a2.id AS award_id,
        SUM(tca.price * COALESCE(ri.quantity, 1)) AS total_price,
        COUNT(DISTINCT tca.rfq_item_id) AS item_count
    FROM awards a2
    INNER JOIN quotes q ON a2.quoteId = q.id
    INNER JOIN temp_correct_awards tca ON a2.supplierId = tca.supplier_id
    INNER JOIN rfq_items ri ON tca.rfq_item_id = ri.id
    WHERE a2.rfqId = @rfq_id
      AND a2.status = 'ACTIVE'
    GROUP BY a2.id
) AS calc ON a.id = calc.award_id
SET a.finalPrice = calc.total_price,
    a.reason = CONCAT('系统自动评标：按商品维度选择最低报价，共 ', calc.item_count, ' 个商品中标'),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status = 'ACTIVE';

-- 删除临时表
DROP TEMPORARY TABLE IF EXISTS temp_correct_awards;

-- 验证修复结果
SELECT '=== 修复后的 Award 记录 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    COUNT(DISTINCT qi.rfqItemId) AS item_count,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
INNER JOIN rfqs r ON a.rfqId = r.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND a.status = 'ACTIVE'
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason
ORDER BY u.username;

SELECT '=== 检查是否还有重复的 Award ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') AS suppliers
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN awards a ON q.id = a.quoteId
INNER JOIN users u ON a.supplierId = u.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND a.status = 'ACTIVE'
  AND qi.rfqItemId = ri.id
GROUP BY ri.id, ri.productName
HAVING active_award_count > 1;

COMMIT;

SELECT '=== 修复完成 ===' AS section;

