-- ============================================
-- 修复福袋商品错误中标问题
-- RFQ-1764574989800
-- 问题：福袋商品一口价¥86.00，"可乐"和"赛罗"报价¥86.00应该中标，但"豪"（¥89.00）被错误选中
-- ============================================

-- ============================================
-- 第一步：查询相关数据
-- ============================================

-- 1. 查找询价单ID
SELECT id, rfqNo, status, buyerId 
FROM rfqs 
WHERE rfqNo = 'RFQ-1764574989800';

-- 2. 查找福袋商品的rfqItemId（替换下面的 'RFQ_ID' 为上面查询到的id）
-- SELECT id, productName, instantPrice, maxPrice, itemStatus, quantity
-- FROM rfq_items 
-- WHERE rfqId = 'RFQ_ID' AND productName LIKE '%模玩兽100元福袋%'
-- ORDER BY createdAt;

-- 3. 查找所有供应商对该询价单的报价（替换下面的 'RFQ_ID' 为上面查询到的id）
-- SELECT q.id as quote_id, u.username, u.id as supplier_id, q.status as quote_status, q.createdAt
-- FROM quotes q
-- INNER JOIN users u ON q.supplierId = u.id
-- WHERE q.rfqId = 'RFQ_ID'
-- ORDER BY u.username;

-- 4. 查找福袋商品的所有报价（替换下面的 'RFQ_ID' 和 'RFQ_ITEM_ID'）
-- SELECT 
--   qi.id as quote_item_id,
--   qi.quoteId,
--   qi.rfqItemId,
--   qi.price,
--   q.supplierId,
--   u.username as supplier_name,
--   ri.productName,
--   ri.instantPrice,
--   ri.itemStatus
-- FROM quote_items qi
-- INNER JOIN quotes q ON qi.quoteId = q.id
-- INNER JOIN users u ON q.supplierId = u.id
-- INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
-- WHERE ri.rfqId = 'RFQ_ID' 
--   AND ri.productName LIKE '%模玩兽100元福袋%'
-- ORDER BY qi.price ASC, u.username;

-- 5. 查找"豪"的Award记录（替换下面的 'RFQ_ID'）
-- SELECT 
--   a.id as award_id,
--   a.rfqId,
--   a.quoteId,
--   a.supplierId,
--   u.username as supplier_name,
--   a.finalPrice,
--   a.status,
--   a.reason
-- FROM awards a
-- INNER JOIN users u ON a.supplierId = u.id
-- WHERE a.rfqId = 'RFQ_ID' AND u.username = '豪';

-- ============================================
-- 第二步：执行修复（需要替换下面的变量）
-- ============================================
-- 变量说明：
-- @RFQ_ID: 询价单ID（从第一步查询得到）
-- @RFQ_ITEM_ID_KELE: "可乐"报价的rfqItemId（从第4步查询得到，选择价格=86.00的）
-- @QUOTE_ID_KELE: "可乐"的报价ID（从第4步查询得到）
-- @SUPPLIER_ID_KELE: "可乐"的供应商ID（从第3步查询得到）
-- @SUPPLIER_ID_HAO: "豪"的供应商ID（从第3步查询得到）
-- @AWARD_ID_HAO: "豪"的Award记录ID（从第5步查询得到，如果有）

-- 开始事务
START TRANSACTION;

-- 1. 重置"豪"中标的福袋商品状态为PENDING
-- 注意：只重置福袋商品，不重置其他商品（如SHF巧爷）
UPDATE rfq_items 
SET itemStatus = 'PENDING'
WHERE rfqId = @RFQ_ID
  AND productName LIKE '%模玩兽100元福袋%'
  AND itemStatus = 'AWARDED'
  AND id IN (
    -- 查找"豪"中标的福袋商品
    SELECT qi.rfqItemId
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    WHERE q.supplierId = @SUPPLIER_ID_HAO
      AND qi.rfqItemId IN (
        SELECT id FROM rfq_items 
        WHERE rfqId = @RFQ_ID 
          AND productName LIKE '%模玩兽100元福袋%'
      )
  );

-- 2. 将"可乐"的报价设置为中标（选择价格=86.00的报价项）
UPDATE rfq_items 
SET itemStatus = 'AWARDED'
WHERE id IN (
  SELECT qi.rfqItemId
  FROM quote_items qi
  INNER JOIN quotes q ON qi.quoteId = q.id
  INNER JOIN users u ON q.supplierId = u.id
  WHERE qi.rfqItemId IN (
    SELECT id FROM rfq_items 
    WHERE rfqId = @RFQ_ID 
      AND productName LIKE '%模玩兽100元福袋%'
      AND itemStatus = 'PENDING'
  )
  AND u.username = '可乐'
  AND qi.price = 86.00
);

-- 3. 更新"可乐"的报价状态为AWARDED（如果该报价有商品中标）
UPDATE quotes
SET status = 'AWARDED'
WHERE id = @QUOTE_ID_KELE
  AND id IN (
    -- 确保该报价有商品中标
    SELECT DISTINCT q.id
    FROM quotes q
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE ri.itemStatus = 'AWARDED'
      AND q.supplierId = @SUPPLIER_ID_KELE
  );

-- 4. 检查"豪"的报价是否还有其他商品中标
-- 如果"豪"的报价还有其他商品中标（如SHF巧爷），则只更新报价状态，不删除Award记录
-- 如果"豪"的报价没有其他商品中标，则将报价状态更新为REJECTED

-- 4.1 检查"豪"的报价是否还有其他商品中标
-- SELECT COUNT(*) as awarded_count
-- FROM quote_items qi
-- INNER JOIN quotes q ON qi.quoteId = q.id
-- INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
-- WHERE q.supplierId = @SUPPLIER_ID_HAO
--   AND q.rfqId = @RFQ_ID
--   AND ri.itemStatus = 'AWARDED'
--   AND ri.productName NOT LIKE '%模玩兽100元福袋%';

-- 4.2 如果"豪"的报价没有其他商品中标，更新报价状态为REJECTED
-- （需要根据上面的查询结果手动执行）
-- UPDATE quotes
-- SET status = 'REJECTED'
-- WHERE id IN (
--   SELECT DISTINCT q.id
--   FROM quotes q
--   INNER JOIN quote_items qi ON q.id = qi.quoteId
--   WHERE q.supplierId = @SUPPLIER_ID_HAO
--     AND q.rfqId = @RFQ_ID
--     AND q.id NOT IN (
--       -- 如果该报价有其他商品中标，不更新状态
--       SELECT DISTINCT q2.id
--       FROM quotes q2
--       INNER JOIN quote_items qi2 ON q2.id = qi2.quoteId
--       INNER JOIN rfq_items ri2 ON qi2.rfqItemId = ri2.id
--       WHERE ri2.itemStatus = 'AWARDED'
--         AND q2.supplierId = @SUPPLIER_ID_HAO
--         AND ri2.productName NOT LIKE '%模玩兽100元福袋%'
--     )
-- );

-- 5. 更新或删除"豪"的Award记录
-- 5.1 如果"豪"的Award记录只包含福袋商品，需要删除或更新
-- 5.2 如果"豪"的Award记录还包含其他商品（如SHF巧爷），则只更新finalPrice

-- 5.1 检查"豪"的Award记录包含哪些商品
-- SELECT 
--   a.id as award_id,
--   ri.productName,
--   ri.itemStatus,
--   qi.price,
--   ri.quantity
-- FROM awards a
-- INNER JOIN quotes q ON a.quoteId = q.id
-- INNER JOIN quote_items qi ON q.id = qi.quoteId
-- INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
-- WHERE a.id = @AWARD_ID_HAO
-- ORDER BY ri.productName;

-- 5.2 如果Award记录只包含福袋商品，删除该Award记录
-- DELETE FROM awards
-- WHERE id = @AWARD_ID_HAO
--   AND id NOT IN (
--     -- 如果Award记录还包含其他商品，不删除
--     SELECT DISTINCT a2.id
--     FROM awards a2
--     INNER JOIN quotes q2 ON a2.quoteId = q2.id
--     INNER JOIN quote_items qi2 ON q2.id = qi2.quoteId
--     INNER JOIN rfq_items ri2 ON qi2.rfqItemId = ri2.id
--     WHERE ri2.itemStatus = 'AWARDED'
--       AND a2.id = @AWARD_ID_HAO
--       AND ri2.productName NOT LIKE '%模玩兽100元福袋%'
--   );

-- 5.3 如果Award记录还包含其他商品，更新finalPrice
-- UPDATE awards
-- SET finalPrice = (
--   SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
--   FROM quote_items qi
--   INNER JOIN quotes q ON qi.quoteId = q.id
--   INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
--   WHERE q.supplierId = @SUPPLIER_ID_HAO
--     AND q.rfqId = @RFQ_ID
--     AND ri.itemStatus = 'AWARDED'
--     AND ri.productName NOT LIKE '%模玩兽100元福袋%'
-- )
-- WHERE id = @AWARD_ID_HAO
--   AND id IN (
--     -- 确保Award记录还包含其他商品
--     SELECT DISTINCT a2.id
--     FROM awards a2
--     INNER JOIN quotes q2 ON a2.quoteId = q2.id
--     INNER JOIN quote_items qi2 ON q2.id = qi2.quoteId
--     INNER JOIN rfq_items ri2 ON qi2.rfqItemId = ri2.id
--     WHERE ri2.itemStatus = 'AWARDED'
--       AND a2.id = @AWARD_ID_HAO
--       AND ri2.productName NOT LIKE '%模玩兽100元福袋%'
--   );

-- 6. 为"可乐"创建或更新Award记录
-- 6.1 检查"可乐"是否已有Award记录
-- SELECT id, rfqId, quoteId, supplierId, finalPrice, status
-- FROM awards
-- WHERE rfqId = @RFQ_ID
--   AND supplierId = @SUPPLIER_ID_KELE;

-- 6.2 如果"可乐"没有Award记录，创建新的Award记录
-- INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, status, reason, createdAt, updatedAt)
-- SELECT 
--   CONCAT('award_', UUID()) as id,
--   @RFQ_ID as rfqId,
--   @QUOTE_ID_KELE as quoteId,
--   @SUPPLIER_ID_KELE as supplierId,
--   COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0) as finalPrice,
--   'ACTIVE' as status,
--   '系统自动评标：福袋商品满足一口价条件（¥86.00 <= ¥86.00）' as reason,
--   NOW() as createdAt,
--   NOW() as updatedAt
-- FROM quote_items qi
-- INNER JOIN quotes q ON qi.quoteId = q.id
-- INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
-- WHERE q.supplierId = @SUPPLIER_ID_KELE
--   AND q.rfqId = @RFQ_ID
--   AND ri.itemStatus = 'AWARDED'
--   AND NOT EXISTS (
--     SELECT 1 FROM awards a 
--     WHERE a.rfqId = @RFQ_ID 
--       AND a.supplierId = @SUPPLIER_ID_KELE
--   );

-- 6.3 如果"可乐"已有Award记录，更新finalPrice
-- UPDATE awards
-- SET finalPrice = (
--   SELECT COALESCE(SUM(qi.price * COALESCE(ri.quantity, 1)), 0)
--   FROM quote_items qi
--   INNER JOIN quotes q ON qi.quoteId = q.id
--   INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
--   WHERE q.supplierId = @SUPPLIER_ID_KELE
--     AND q.rfqId = @RFQ_ID
--     AND ri.itemStatus = 'AWARDED'
-- ),
-- updatedAt = NOW()
-- WHERE rfqId = @RFQ_ID
--   AND supplierId = @SUPPLIER_ID_KELE;

-- 提交事务
COMMIT;

-- ============================================
-- 第三步：验证修复结果
-- ============================================

-- 1. 验证福袋商品的中标状态
-- SELECT 
--   ri.id,
--   ri.productName,
--   ri.itemStatus,
--   ri.instantPrice,
--   qi.price as quote_price,
--   u.username as supplier_name
-- FROM rfq_items ri
-- LEFT JOIN quote_items qi ON ri.id = qi.rfqItemId
-- LEFT JOIN quotes q ON qi.quoteId = q.id
-- LEFT JOIN users u ON q.supplierId = u.id
-- WHERE ri.rfqId = @RFQ_ID
--   AND ri.productName LIKE '%模玩兽100元福袋%'
--   AND ri.itemStatus = 'AWARDED'
-- ORDER BY ri.id, qi.price;

-- 2. 验证"可乐"的报价状态
-- SELECT q.id, q.status, u.username, COUNT(qi.id) as awarded_items_count
-- FROM quotes q
-- INNER JOIN users u ON q.supplierId = u.id
-- LEFT JOIN quote_items qi ON q.id = qi.quoteId
-- LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id AND ri.itemStatus = 'AWARDED'
-- WHERE q.rfqId = @RFQ_ID
--   AND u.username = '可乐'
-- GROUP BY q.id, q.status, u.username;

-- 3. 验证"豪"的报价状态
-- SELECT q.id, q.status, u.username, COUNT(qi.id) as awarded_items_count
-- FROM quotes q
-- INNER JOIN users u ON q.supplierId = u.id
-- LEFT JOIN quote_items qi ON q.id = qi.quoteId
-- LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id AND ri.itemStatus = 'AWARDED'
-- WHERE q.rfqId = @RFQ_ID
--   AND u.username = '豪'
-- GROUP BY q.id, q.status, u.username;

-- 4. 验证Award记录
-- SELECT 
--   a.id,
--   u.username,
--   a.finalPrice,
--   a.status,
--   COUNT(DISTINCT ri.id) as awarded_items_count
-- FROM awards a
-- INNER JOIN users u ON a.supplierId = u.id
-- LEFT JOIN quotes q ON a.quoteId = q.id
-- LEFT JOIN quote_items qi ON q.id = qi.quoteId
-- LEFT JOIN rfq_items ri ON qi.rfqItemId = ri.id AND ri.itemStatus = 'AWARDED'
-- WHERE a.rfqId = @RFQ_ID
-- GROUP BY a.id, u.username, a.finalPrice, a.status;

