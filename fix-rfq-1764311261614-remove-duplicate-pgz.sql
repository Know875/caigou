-- 删除 RFQ-1764311261614 中豪的重复 PGZ高达（没有物流单号的那个）
-- 注意：执行前请先运行 check-rfq-1764311261614-pgz-duplicate.sql 查看数据

SET @rfq_no = 'RFQ-1764311261614';
SET @product_name = 'PGZ高达';
SET @supplier_name = '豪';

-- 设置变量
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);
SET @supplier_id = (SELECT id FROM users WHERE username COLLATE utf8mb4_unicode_ci = @supplier_name COLLATE utf8mb4_unicode_ci LIMIT 1);

-- 查找没有物流单号的 PGZ高达 RFQ Item（应该删除这个）
SET @rfq_item_to_delete = (
    SELECT ri.id
    FROM rfq_items ri
    INNER JOIN rfqs r ON ri.rfqId = r.id
    WHERE BINARY r.rfqNo = BINARY @rfq_no
      AND ri.productName LIKE '%PGZ高达%'
      AND (ri.trackingNo IS NULL OR ri.trackingNo = '')
      AND ri.item_status = 'AWARDED'
    ORDER BY ri.createdAt DESC
    LIMIT 1
);

-- 查找有物流单号的 PGZ高达 RFQ Item（应该保留这个）
SET @rfq_item_to_keep = (
    SELECT ri.id
    FROM rfq_items ri
    INNER JOIN rfqs r ON ri.rfqId = r.id
    WHERE BINARY r.rfqNo = BINARY @rfq_no
      AND ri.productName LIKE '%PGZ高达%'
      AND ri.trackingNo IS NOT NULL
      AND ri.trackingNo != ''
      AND ri.item_status = 'AWARDED'
    ORDER BY ri.createdAt
    LIMIT 1
);

-- 检查变量
SELECT '=== 变量设置 ===' AS section;
SELECT 
    @rfq_id AS rfq_id,
    @supplier_id AS supplier_id,
    @rfq_item_to_delete AS rfq_item_to_delete,
    @rfq_item_to_keep AS rfq_item_to_keep;

-- 查找要删除的 RFQ Item 相关的 QuoteItem
SET @quote_item_to_delete = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    WHERE qi.rfqItemId = @rfq_item_to_delete
      AND q.supplierId = @supplier_id
    LIMIT 1
);

-- 查找要删除的 RFQ Item 相关的 Shipment
SET @shipment_to_delete = (
    SELECT s.id
    FROM shipments s
    WHERE s.rfqItemId = @rfq_item_to_delete
      AND s.supplierId = @supplier_id
      AND (s.trackingNo IS NULL OR s.trackingNo = '')
    LIMIT 1
);

SELECT '=== 要删除的数据 ===' AS section;
SELECT 
    @quote_item_to_delete AS quote_item_to_delete,
    @shipment_to_delete AS shipment_to_delete;

-- ============================================
-- 开始修复
-- ============================================

SET autocommit = 0;
START TRANSACTION;

-- 1. 删除相关的 Shipment（如果存在）
DELETE FROM shipments
WHERE id = @shipment_to_delete
  AND @shipment_to_delete IS NOT NULL;

SELECT 
    CASE 
        WHEN @shipment_to_delete IS NOT NULL THEN CONCAT('已删除 Shipment: ', @shipment_to_delete)
        ELSE '没有需要删除的 Shipment'
    END AS message;

-- 2. 删除 QuoteItem（如果存在）
DELETE FROM quote_items
WHERE id = @quote_item_to_delete
  AND @quote_item_to_delete IS NOT NULL;

SELECT 
    CASE 
        WHEN @quote_item_to_delete IS NOT NULL THEN CONCAT('已删除 QuoteItem: ', @quote_item_to_delete)
        ELSE '没有需要删除的 QuoteItem'
    END AS message;

-- 3. 删除 RFQ Item（如果存在）
DELETE FROM rfq_items
WHERE id = @rfq_item_to_delete
  AND @rfq_item_to_delete IS NOT NULL;

SELECT 
    CASE 
        WHEN @rfq_item_to_delete IS NOT NULL THEN CONCAT('已删除 RFQ Item: ', @rfq_item_to_delete)
        ELSE '没有需要删除的 RFQ Item'
    END AS message;

-- 4. 更新豪的 Award 价格（重新计算，排除已删除的商品）
SET @quote_id = (
    SELECT q.id
    FROM quotes q
    WHERE q.rfqId = @rfq_id
      AND q.supplierId = @supplier_id
    LIMIT 1
);

SET @new_final_price = (
    SELECT COALESCE(SUM(qi.price * ri.quantity), 0)
    FROM quote_items qi
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE qi.quoteId = @quote_id
      AND ri.id != @rfq_item_to_delete
);

UPDATE awards
SET finalPrice = @new_final_price,
    updatedAt = NOW()
WHERE rfqId = @rfq_id
  AND supplierId = @supplier_id
  AND status != 'CANCELLED'
  AND @new_final_price > 0;

SELECT 
    CASE 
        WHEN @new_final_price > 0 THEN CONCAT('已更新 Award 价格: ', @new_final_price)
        ELSE 'Award 价格更新失败'
    END AS message;

-- 5. 验证修复结果
SELECT '=== 修复后的数据 ===' AS section;

-- 查看剩余的 PGZ高达
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.trackingNo,
    ri.item_status,
    qi.price,
    s.id AS shipment_id,
    s.trackingNo AS shipment_tracking_no
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
LEFT JOIN quote_items qi ON qi.rfqItemId = ri.id
LEFT JOIN quotes q ON qi.quoteId = q.id AND q.supplierId = @supplier_id
LEFT JOIN shipments s ON s.rfqItemId = ri.id AND s.supplierId = @supplier_id
WHERE BINARY r.rfqNo = BINARY @rfq_no
  AND ri.productName LIKE '%PGZ高达%'
ORDER BY ri.createdAt;

-- 查看豪的 Award
SELECT 
    a.id AS award_id,
    a.finalPrice,
    GROUP_CONCAT(ri.productName ORDER BY ri.productName) AS products
FROM awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON qi.quoteId = q.id
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE a.rfqId = @rfq_id
  AND a.supplierId = @supplier_id
  AND a.status != 'CANCELLED'
GROUP BY a.id, a.finalPrice;

-- 提交事务
COMMIT;

SELECT '=== 修复完成 ===' AS section;
SELECT '事务已自动提交。' AS notice;

