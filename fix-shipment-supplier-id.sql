-- ============================================
-- 修复发货单 supplierId 错误关联问题
-- 问题：赛罗中标了UR神光棒，但是发货单的supplierId被错误地设置为"豪"的ID
-- ============================================

-- ============================================
-- 第一步：查询相关数据
-- ============================================

-- 1. 查找询价单ID（根据商品名称或询价单编号）
-- SELECT id, rfqNo, status 
-- FROM rfqs 
-- WHERE rfqNo LIKE '%RFQ%' OR id IN (
--   SELECT DISTINCT rfqId FROM rfq_items WHERE productName LIKE '%UR神光棒%'
-- );

-- 2. 查找UR神光棒商品的rfqItemId（替换下面的 'RFQ_ID'）
-- SELECT id, productName, itemStatus, rfqId
-- FROM rfq_items 
-- WHERE rfqId = 'RFQ_ID' AND productName LIKE '%UR神光棒%';

-- 3. 查找该商品的所有报价（替换下面的 'RFQ_ITEM_ID'）
-- SELECT 
--   qi.id as quote_item_id,
--   qi.quoteId,
--   qi.rfqItemId,
--   qi.price,
--   q.supplierId,
--   u.username as supplier_name,
--   ri.productName,
--   ri.itemStatus
-- FROM quote_items qi
-- INNER JOIN quotes q ON qi.quoteId = q.id
-- INNER JOIN users u ON q.supplierId = u.id
-- INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
-- WHERE qi.rfqItemId = 'RFQ_ITEM_ID'
-- ORDER BY qi.price ASC, u.username;

-- 4. 查找该商品的所有发货单（替换下面的 'RFQ_ITEM_ID'）
-- SELECT 
--   s.id as shipment_id,
--   s.shipmentNo,
--   s.rfqItemId,
--   s.supplierId,
--   u.username as supplier_name,
--   s.trackingNo,
--   s.carrier,
--   s.status,
--   s.createdAt,
--   ri.productName
-- FROM shipments s
-- INNER JOIN users u ON s.supplierId = u.id
-- INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
-- WHERE s.rfqItemId = 'RFQ_ITEM_ID'
-- ORDER BY s.createdAt DESC;

-- 5. 查找中标供应商（替换下面的 'RFQ_ITEM_ID'）
-- 方法1：通过Award记录查找
-- SELECT 
--   a.id as award_id,
--   a.supplierId,
--   u.username as supplier_name,
--   qi.id as quote_item_id,
--   qi.price,
--   ri.productName
-- FROM awards a
-- INNER JOIN quotes q ON a.quoteId = q.id
-- INNER JOIN quote_items qi ON q.id = qi.quoteId
-- INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
-- INNER JOIN users u ON a.supplierId = u.id
-- WHERE qi.rfqItemId = 'RFQ_ITEM_ID'
--   AND ri.itemStatus = 'AWARDED';

-- 方法2：通过价格最低的报价查找（如果没有Award记录）
-- SELECT 
--   qi.id as quote_item_id,
--   qi.quoteId,
--   qi.price,
--   q.supplierId,
--   u.username as supplier_name,
--   ri.productName,
--   ri.itemStatus
-- FROM quote_items qi
-- INNER JOIN quotes q ON qi.quoteId = q.id
-- INNER JOIN users u ON q.supplierId = u.id
-- INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
-- WHERE qi.rfqItemId = 'RFQ_ITEM_ID'
--   AND ri.itemStatus = 'AWARDED'
-- ORDER BY qi.price ASC
-- LIMIT 1;

-- ============================================
-- 第二步：执行修复（需要替换下面的变量）
-- ============================================
-- 变量说明：
-- @RFQ_ITEM_ID: UR神光棒商品的rfqItemId（从步骤2查询得到）
-- @SHIPMENT_ID: 错误的发货单ID（从步骤4查询得到）
-- @WRONG_SUPPLIER_ID: "豪"的供应商ID（从步骤4查询得到）
-- @CORRECT_SUPPLIER_ID: "赛罗"的供应商ID（从步骤5查询得到）
-- @AWARD_ID: Award记录ID（从步骤5查询得到，如果有）

-- 开始事务
START TRANSACTION;

-- 1. 验证发货单的supplierId是否错误
-- SELECT 
--   s.id,
--   s.supplierId as current_supplier_id,
--   u1.username as current_supplier_name,
--   ri.productName,
--   ri.itemStatus,
--   -- 查找中标供应商
--   (SELECT u2.username 
--    FROM quote_items qi2
--    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
--    INNER JOIN users u2 ON q2.supplierId = u2.id
--    WHERE qi2.rfqItemId = s.rfqItemId
--      AND ri.itemStatus = 'AWARDED'
--    ORDER BY qi2.price ASC
--    LIMIT 1) as winning_supplier_name
-- FROM shipments s
-- INNER JOIN users u1 ON s.supplierId = u1.id
-- INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
-- WHERE s.id = @SHIPMENT_ID;

-- 2. 更新发货单的supplierId为正确的供应商ID
UPDATE shipments
SET supplierId = @CORRECT_SUPPLIER_ID,
    updatedAt = NOW()
WHERE id = @SHIPMENT_ID
  AND supplierId = @WRONG_SUPPLIER_ID
  AND rfqItemId = @RFQ_ITEM_ID;

-- 3. 验证更新结果
-- SELECT 
--   s.id,
--   s.supplierId,
--   u.username as supplier_name,
--   ri.productName
-- FROM shipments s
-- INNER JOIN users u ON s.supplierId = u.id
-- INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
-- WHERE s.id = @SHIPMENT_ID;

-- 4. 如果Award记录存在，确保Award记录的supplierId正确
-- （通常Award记录应该是正确的，但可以验证一下）
-- SELECT 
--   a.id,
--   a.supplierId,
--   u.username as supplier_name,
--   a.rfqId
-- FROM awards a
-- INNER JOIN users u ON a.supplierId = u.id
-- WHERE a.id = @AWARD_ID;

-- 提交事务
COMMIT;

-- ============================================
-- 第三步：批量修复（如果需要修复多个发货单）
-- ============================================

-- 查找所有supplierId错误的发货单
-- SELECT 
--   s.id as shipment_id,
--   s.rfqItemId,
--   s.supplierId as wrong_supplier_id,
--   u1.username as wrong_supplier_name,
--   ri.productName,
--   ri.itemStatus,
--   -- 查找正确的供应商ID
--   (SELECT q2.supplierId
--    FROM quote_items qi2
--    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
--    WHERE qi2.rfqItemId = s.rfqItemId
--      AND ri.itemStatus = 'AWARDED'
--    ORDER BY qi2.price ASC
--    LIMIT 1) as correct_supplier_id,
--   (SELECT u2.username
--    FROM quote_items qi2
--    INNER JOIN quotes q2 ON qi2.quoteId = q2.id
--    INNER JOIN users u2 ON q2.supplierId = u2.id
--    WHERE qi2.rfqItemId = s.rfqItemId
--      AND ri.itemStatus = 'AWARDED'
--    ORDER BY qi2.price ASC
--    LIMIT 1) as correct_supplier_name
-- FROM shipments s
-- INNER JOIN users u1 ON s.supplierId = u1.id
-- INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
-- WHERE ri.itemStatus = 'AWARDED'
--   AND s.supplierId != (
--     -- 查找中标供应商ID
--     SELECT q2.supplierId
--     FROM quote_items qi2
--     INNER JOIN quotes q2 ON qi2.quoteId = q2.id
--     WHERE qi2.rfqItemId = s.rfqItemId
--     ORDER BY qi2.price ASC
--     LIMIT 1
--   );

-- 批量更新（谨慎使用，建议先执行上面的查询确认数据）
-- UPDATE shipments s
-- INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
-- INNER JOIN (
--   SELECT 
--     qi.rfqItemId,
--     q.supplierId as correct_supplier_id
--   FROM quote_items qi
--   INNER JOIN quotes q ON qi.quoteId = q.id
--   WHERE ri.itemStatus = 'AWARDED'
--   GROUP BY qi.rfqItemId
--   HAVING MIN(qi.price) = (
--     SELECT MIN(qi2.price)
--     FROM quote_items qi2
--     WHERE qi2.rfqItemId = qi.rfqItemId
--   )
-- ) as correct_suppliers ON s.rfqItemId = correct_suppliers.rfqItemId
-- SET s.supplierId = correct_suppliers.correct_supplier_id,
--     s.updatedAt = NOW()
-- WHERE ri.itemStatus = 'AWARDED'
--   AND s.supplierId != correct_suppliers.correct_supplier_id;

-- ============================================
-- 注意事项
-- ============================================
-- 1. 在执行修复SQL之前，务必先执行查询语句确认数据
-- 2. 建议先修复单个发货单，验证结果正确后再批量修复
-- 3. 如果Award记录存在，优先使用Award记录确定中标供应商
-- 4. 如果没有Award记录，使用价格最低的报价确定中标供应商
-- 5. 修复后，验证发货单的supplierId是否正确

