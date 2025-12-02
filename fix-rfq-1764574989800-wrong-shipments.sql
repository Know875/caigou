-- 修复 RFQ-1764574989800 的错误发货单数据
-- 问题：之前不属于中标的供应商上传了快递单号，现在真正中标的供应商上传不了
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

-- 1.2 查看每个商品的中标情况和发货单情况
SELECT 
    '=== 每个商品的中标和发货单情况 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.shipmentId,
    ri.trackingNo,
    ri.carrier,
    -- 真正中标的供应商
    u_correct.username as correct_supplier,
    qi_correct.price as correct_price,
    a_correct.id as correct_award_id,
    -- 发货单信息
    s.id as shipment_id,
    s.shipmentNo,
    s.supplierId as shipment_supplier_id,
    u_shipment.username as shipment_supplier_name,
    s.trackingNo as shipment_tracking_no,
    s.carrier as shipment_carrier,
    s.status as shipment_status,
    s.createdAt as shipment_created_at,
    -- 判断是否正确
    CASE 
        WHEN s.id IS NULL THEN '✅ 无发货单'
        WHEN s.supplierId = u_correct.id THEN '✅ 正确（中标供应商上传）'
        WHEN s.supplierId != u_correct.id THEN '❌ 错误（非中标供应商上传）'
        ELSE '⚠️ 需要检查'
    END as shipment_check
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
-- 找到真正中标的供应商（通过 Award 记录）
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
    WHERE ri2.rfqId = @rfq_id
      AND ri2.item_status = 'AWARDED'
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
-- 查找发货单
LEFT JOIN shipments s ON s.rfqItemId = ri.id AND s.source = 'SUPPLIER'
LEFT JOIN users u_shipment ON s.supplierId = u_shipment.id
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;

-- 1.3 查看所有发货单详情
SELECT 
    '=== 所有发货单详情 ===' as section;

SELECT 
    s.id as shipment_id,
    s.shipmentNo,
    s.rfqItemId,
    ri.productName,
    s.supplierId,
    u.username as supplier_name,
    s.trackingNo,
    s.carrier,
    s.status,
    s.createdAt,
    s.awardId,
    -- 检查该供应商是否真的中标了该商品
    CASE 
        WHEN EXISTS (
            SELECT 1 
            FROM awards a
            INNER JOIN quotes q ON a.quoteId = q.id
            INNER JOIN quote_items qi ON qi.quoteId = q.id
            WHERE a.rfqId = @rfq_id
              AND a.supplierId = s.supplierId
              AND a.status != 'CANCELLED'
              AND qi.rfqItemId = s.rfqItemId
              AND EXISTS (
                  SELECT 1 
                  FROM quote_items qi2 
                  WHERE qi2.quoteId = a.quoteId 
                  AND qi2.rfqItemId = s.rfqItemId
                  AND qi2.id = qi.id
              )
        ) THEN '✅ 正确'
        ELSE '❌ 错误（非中标供应商）'
    END as validation
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
LEFT JOIN users u ON s.supplierId = u.id
WHERE ri.rfqId = @rfq_id
  AND s.source = 'SUPPLIER'
ORDER BY ri.productName, s.createdAt;

-- ============================================
-- 第二部分：修复数据（需要根据查询结果确认后执行）
-- ============================================

START TRANSACTION;

-- 2.1 删除错误的上传发货单（非中标供应商上传的）
-- 对于每个已中标的商品，找到真正中标的供应商，然后删除其他供应商的发货单

DELETE s FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
  AND s.source = 'SUPPLIER'
  -- 该发货单的供应商不是真正中标的供应商
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a
      INNER JOIN quotes q ON a.quoteId = q.id
      INNER JOIN quote_items qi ON qi.quoteId = q.id
      WHERE a.rfqId = @rfq_id
        AND a.supplierId = s.supplierId
        AND a.status != 'CANCELLED'
        AND qi.rfqItemId = s.rfqItemId
        -- 验证该 Award 对应的 quote 中确实包含该报价项
        AND EXISTS (
            SELECT 1 
            FROM quote_items qi2 
            WHERE qi2.quoteId = a.quoteId 
            AND qi2.rfqItemId = s.rfqItemId
            AND qi2.id = qi.id
        )
  );

-- 2.2 清理 RfqItem 中关联的错误 shipmentId
-- 如果 RfqItem.shipmentId 指向已删除的发货单，需要清空
UPDATE rfq_items ri
SET 
    ri.shipmentId = NULL,
    ri.trackingNo = NULL,
    ri.carrier = NULL,
    ri.source = NULL
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
  AND ri.shipmentId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 
      FROM shipments s 
      WHERE s.id = ri.shipmentId
  );

-- 2.3 如果 RfqItem.shipmentId 指向错误的发货单（非中标供应商的），也需要清空
UPDATE rfq_items ri
INNER JOIN shipments s ON s.id = ri.shipmentId
SET 
    ri.shipmentId = NULL,
    ri.trackingNo = NULL,
    ri.carrier = NULL,
    ri.source = NULL
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
  AND s.source = 'SUPPLIER'
  -- 该发货单的供应商不是真正中标的供应商
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a
      INNER JOIN quotes q ON a.quoteId = q.id
      INNER JOIN quote_items qi ON qi.quoteId = q.id
      WHERE a.rfqId = @rfq_id
        AND a.supplierId = s.supplierId
        AND a.status != 'CANCELLED'
        AND qi.rfqItemId = ri.id
        -- 验证该 Award 对应的 quote 中确实包含该报价项
        AND EXISTS (
            SELECT 1 
            FROM quote_items qi2 
            WHERE qi2.quoteId = a.quoteId 
            AND qi2.rfqItemId = ri.id
            AND qi2.id = qi.id
        )
  );

-- ============================================
-- 第三部分：验证修复结果
-- ============================================

-- 3.1 验证修复后的发货单情况
SELECT 
    '=== 修复后的发货单情况 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.shipmentId,
    ri.trackingNo,
    -- 真正中标的供应商
    u_correct.username as correct_supplier,
    -- 发货单信息
    s.id as shipment_id,
    u_shipment.username as shipment_supplier_name,
    s.trackingNo as shipment_tracking_no,
    CASE 
        WHEN s.id IS NULL THEN '✅ 无发货单（可以上传）'
        WHEN s.supplierId = u_correct.id THEN '✅ 正确（中标供应商上传）'
        ELSE '❌ 仍有问题'
    END as validation
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
-- 找到真正中标的供应商（通过 Award 记录）
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
    WHERE ri2.rfqId = @rfq_id
      AND ri2.item_status = 'AWARDED'
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
-- 查找发货单
LEFT JOIN shipments s ON s.rfqItemId = ri.id AND s.source = 'SUPPLIER'
LEFT JOIN users u_shipment ON s.supplierId = u_shipment.id
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;

-- 3.2 检查是否还有错误的发货单
SELECT 
    '=== 检查是否还有错误的发货单 ===' as section;

SELECT 
    COUNT(*) as wrong_shipment_count
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId = ri.id
WHERE ri.rfqId = @rfq_id
  AND ri.item_status = 'AWARDED'
  AND s.source = 'SUPPLIER'
  -- 该发货单的供应商不是真正中标的供应商
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a
      INNER JOIN quotes q ON a.quoteId = q.id
      INNER JOIN quote_items qi ON qi.quoteId = q.id
      WHERE a.rfqId = @rfq_id
        AND a.supplierId = s.supplierId
        AND a.status != 'CANCELLED'
        AND qi.rfqItemId = s.rfqItemId
        -- 验证该 Award 对应的 quote 中确实包含该报价项
        AND EXISTS (
            SELECT 1 
            FROM quote_items qi2 
            WHERE qi2.quoteId = a.quoteId 
            AND qi2.rfqItemId = s.rfqItemId
            AND qi2.id = qi.id
        )
  );

-- 如果验证通过，执行 COMMIT;
-- 如果需要回滚，执行 ROLLBACK;
-- COMMIT;
-- ROLLBACK;

