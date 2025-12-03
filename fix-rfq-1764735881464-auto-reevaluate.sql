-- 修复 RFQ-1764735881464：自动为每个商品选择最低报价的供应商，创建正确的 Award
-- 注意：执行前请先运行 check-rfq-1764735881464.sql 查看数据

SET @rfq_no = 'RFQ-1764735881464';
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);

SELECT '=== 变量设置 ===' AS section;
SELECT @rfq_id AS rfq_id;

-- ============================================
-- 开始修复
-- ============================================

SET autocommit = 0;
START TRANSACTION;

-- 1. 取消所有现有的 ACTIVE Award（因为需要重新评标）
UPDATE awards
SET status = 'CANCELLED',
    cancellation_reason = 'MANUAL_REAWARD',
    cancelled_at = NOW(),
    updatedAt = NOW()
WHERE rfqId = @rfq_id
  AND status = 'ACTIVE';

SELECT CONCAT('已取消 ', ROW_COUNT(), ' 个 ACTIVE Award') AS message;

-- 2. 为每个 AWARDED 商品找到正确的供应商（最低价，价格相同时最早提交）
-- 并创建临时表存储结果
CREATE TEMPORARY TABLE IF NOT EXISTS temp_best_quotes (
    rfq_item_id VARCHAR(255),
    quote_item_id VARCHAR(255),
    quote_id VARCHAR(255),
    supplier_id VARCHAR(255),
    price DECIMAL(10, 2),
    PRIMARY KEY (rfq_item_id)
);

-- 清空临时表
TRUNCATE TABLE temp_best_quotes;

-- 为每个 AWARDED 商品找到最佳报价（最低价，价格相同时最早提交）
INSERT INTO temp_best_quotes (rfq_item_id, quote_item_id, quote_id, supplier_id, price)
SELECT 
    ri.id AS rfq_item_id,
    qi.id AS quote_item_id,
    q.id AS quote_id,
    q.supplierId AS supplier_id,
    qi.price
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON qi.quoteId = q.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.item_status = 'AWARDED'
  AND (
      -- 如果有一口价，优先选择满足一口价的报价（价格 <= instant_price），按提交时间排序
      (ri.instant_price IS NOT NULL 
       AND qi.price <= ri.instant_price
       AND qi.id = (
           SELECT qi2.id
           FROM quote_items qi2
           INNER JOIN quotes q2 ON qi2.quoteId = q2.id
           WHERE qi2.rfqItemId = ri.id
             AND qi2.price <= ri.instant_price
           ORDER BY q2.submittedAt ASC, qi2.price ASC
           LIMIT 1
       ))
      OR
      -- 如果没有一口价或没有满足一口价的报价，选择最低价（价格相同时最早提交）
      (ri.instant_price IS NULL 
       OR NOT EXISTS (
           SELECT 1 FROM quote_items qi3
           INNER JOIN quotes q3 ON qi3.quoteId = q3.id
           WHERE qi3.rfqItemId = ri.id
             AND qi3.price <= ri.instant_price
       )
       AND qi.id = (
           SELECT qi2.id
           FROM quote_items qi2
           INNER JOIN quotes q2 ON qi2.quoteId = q2.id
           WHERE qi2.rfqItemId = ri.id
           ORDER BY qi2.price ASC, q2.submittedAt ASC
           LIMIT 1
       ))
  );

-- 3. 查看临时表中的数据
SELECT '=== 每个商品的最佳报价 ===' AS section;
SELECT 
    tbq.rfq_item_id,
    ri.productName,
    u.username AS supplier_name,
    tbq.price
FROM temp_best_quotes tbq
INNER JOIN rfq_items ri ON tbq.rfq_item_id = ri.id
INNER JOIN users u ON tbq.supplier_id = u.id
ORDER BY ri.productName;

-- 4. 按供应商分组，创建 Award 记录
-- 4.1 为每个供应商计算总价
CREATE TEMPORARY TABLE IF NOT EXISTS temp_supplier_awards (
    supplier_id VARCHAR(255),
    quote_id VARCHAR(255),
    final_price DECIMAL(10, 2),
    item_count INT,
    PRIMARY KEY (supplier_id)
);

TRUNCATE TABLE temp_supplier_awards;

INSERT INTO temp_supplier_awards (supplier_id, quote_id, final_price, item_count)
SELECT 
    tbq.supplier_id,
    tbq.quote_id,
    SUM(tbq.price * COALESCE(ri.quantity, 1)) AS final_price,
    COUNT(*) AS item_count
FROM temp_best_quotes tbq
INNER JOIN rfq_items ri ON tbq.rfq_item_id = ri.id
GROUP BY tbq.supplier_id, tbq.quote_id;

-- 4.2 为每个供应商创建或更新 Award
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
    CONCAT('cmi', SUBSTRING(MD5(CONCAT(@rfq_id, tsa.supplier_id, NOW())), 1, 25)),
    @rfq_id,
    tsa.quote_id,
    tsa.supplier_id,
    tsa.final_price,
    CONCAT('手动修复：重新评标，选择最低报价，共 ', tsa.item_count, ' 个商品中标'),
    'ACTIVE',
    NOW(),
    NOW(),
    NOW()
FROM temp_supplier_awards tsa
WHERE NOT EXISTS (
    SELECT 1 FROM awards a 
    WHERE a.rfqId = @rfq_id 
      AND a.supplierId = tsa.supplier_id 
      AND a.status != 'CANCELLED'
);

-- 4.3 更新已存在的 Award
UPDATE awards a
INNER JOIN temp_supplier_awards tsa ON a.supplierId = tsa.supplier_id
SET a.finalPrice = tsa.final_price,
    a.reason = CONCAT('手动修复：重新评标，选择最低报价，共 ', tsa.item_count, ' 个商品中标'),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED';

-- 5. 验证修复结果
SELECT '=== 修复后的 Award 记录 ===' AS section;
SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status,
    a.finalPrice,
    GROUP_CONCAT(ri.productName ORDER BY ri.productName) AS products
FROM awards a
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND a.status != 'CANCELLED'
GROUP BY a.id, u.username, a.status, a.finalPrice
ORDER BY u.username;

-- 6. 验证每个商品的中标情况
SELECT '=== 每个商品的中标情况（修复后） ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    u.username AS supplier_name,
    qi.price,
    a.status AS award_status,
    a.id AS award_id
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON qi.rfqItemId = ri.id
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN awards a ON a.quoteId = q.id AND a.status != 'CANCELLED'
INNER JOIN users u ON q.supplierId = u.id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.item_status = 'AWARDED'
  AND qi.id IN (SELECT quote_item_id FROM temp_best_quotes WHERE rfq_item_id = ri.id)
ORDER BY ri.productName, qi.price ASC;

-- 清理临时表
DROP TEMPORARY TABLE IF EXISTS temp_best_quotes;
DROP TEMPORARY TABLE IF EXISTS temp_supplier_awards;

-- 提交事务
COMMIT;

SELECT '=== 修复完成 ===' AS section;
SELECT '事务已自动提交。请运行验证脚本确认结果。' AS notice;

