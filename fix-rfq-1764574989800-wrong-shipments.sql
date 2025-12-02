-- 修复 RFQ-1764574989800 的错误发货单数据
-- 问题：之前不属于中标的供应商上传了快递单号，现在真正中标的供应商上传不了
-- 
-- 使用方法：
-- 1. 先执行查询部分，查看当前数据
-- 2. 确认数据后，执行修复部分
-- 3. 最后执行验证部分，确认修复结果

SET @rfq_no = 'RFQ-1764574989800' COLLATE utf8mb4_unicode_ci;
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no COLLATE utf8mb4_unicode_ci);

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
LEFT JOIN awards a ON a.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci AND a.status != 'CANCELLED'
LEFT JOIN rfq_items ri ON ri.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci
WHERE BINARY r.id = BINARY @rfq_id
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
        WHEN s.supplierId COLLATE utf8mb4_unicode_ci = u_correct.id COLLATE utf8mb4_unicode_ci THEN '✅ 正确（中标供应商上传）'
        WHEN s.supplierId COLLATE utf8mb4_unicode_ci != u_correct.id COLLATE utf8mb4_unicode_ci THEN '❌ 错误（非中标供应商上传）'
        ELSE '⚠️ 需要检查'
    END as shipment_check
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci
-- 找到真正中标的供应商（通过 Award 记录）
-- 使用子查询确保每个 rfqItemId 只返回一个中标供应商（优先选择价格最低的）
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id as quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        a.id as award_id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
    INNER JOIN awards a ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri2.id COLLATE utf8mb4_unicode_ci
    WHERE BINARY ri2.rfqId = BINARY @rfq_id
      AND ri2.item_status = 'AWARDED'
    -- 验证该 Award 对应的 quote 中确实包含该报价项
    AND EXISTS (
        SELECT 1 
        FROM quote_items qi2 
        WHERE qi2.quoteId COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
        AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = qi.rfqItemId COLLATE utf8mb4_unicode_ci
        AND qi2.id COLLATE utf8mb4_unicode_ci = qi.id COLLATE utf8mb4_unicode_ci
    )
    -- 确保每个 rfqItemId 只返回一个记录（选择价格最低的，如果价格相同则选择最早创建的）
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON qi3.quoteId COLLATE utf8mb4_unicode_ci = q3.id COLLATE utf8mb4_unicode_ci
        INNER JOIN awards a3 ON a3.quoteId COLLATE utf8mb4_unicode_ci = q3.id COLLATE utf8mb4_unicode_ci AND a3.status != 'CANCELLED'
        INNER JOIN rfq_items ri3 ON qi3.rfqItemId COLLATE utf8mb4_unicode_ci = ri3.id COLLATE utf8mb4_unicode_ci
        WHERE BINARY ri3.rfqId = BINARY @rfq_id
          AND ri3.item_status = 'AWARDED'
          AND BINARY qi3.rfqItemId = BINARY qi.rfqItemId
          AND EXISTS (
              SELECT 1 
              FROM quote_items qi4 
              WHERE qi4.quoteId COLLATE utf8mb4_unicode_ci = a3.quoteId COLLATE utf8mb4_unicode_ci
              AND qi4.rfqItemId COLLATE utf8mb4_unicode_ci = qi3.rfqItemId COLLATE utf8mb4_unicode_ci
              AND qi4.id COLLATE utf8mb4_unicode_ci = qi3.id COLLATE utf8mb4_unicode_ci
          )
        ORDER BY qi3.price ASC, qi3.id ASC
        LIMIT 1
    )
) as correct_award ON correct_award.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN users u_correct ON correct_award.supplierId COLLATE utf8mb4_unicode_ci = u_correct.id COLLATE utf8mb4_unicode_ci
LEFT JOIN quote_items qi_correct ON correct_award.quote_item_id COLLATE utf8mb4_unicode_ci = qi_correct.id COLLATE utf8mb4_unicode_ci
LEFT JOIN awards a_correct ON correct_award.award_id COLLATE utf8mb4_unicode_ci = a_correct.id COLLATE utf8mb4_unicode_ci
-- 查找发货单
LEFT JOIN shipments s ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci AND s.source = 'SUPPLIER'
LEFT JOIN users u_shipment ON s.supplierId COLLATE utf8mb4_unicode_ci = u_shipment.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
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
            INNER JOIN quotes q ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            INNER JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            WHERE BINARY a.rfqId = BINARY @rfq_id
              AND a.supplierId COLLATE utf8mb4_unicode_ci = s.supplierId COLLATE utf8mb4_unicode_ci
              AND a.status != 'CANCELLED'
              AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = s.rfqItemId COLLATE utf8mb4_unicode_ci
              AND EXISTS (
                  SELECT 1 
                  FROM quote_items qi2 
                  WHERE qi2.quoteId COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
                  AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = s.rfqItemId COLLATE utf8mb4_unicode_ci
                  AND qi2.id COLLATE utf8mb4_unicode_ci = qi.id COLLATE utf8mb4_unicode_ci
              )
        ) THEN '✅ 正确'
        ELSE '❌ 错误（非中标供应商）'
    END as validation
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN users u ON s.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND s.source = 'SUPPLIER'
ORDER BY ri.productName, s.createdAt;

-- ============================================
-- 第二部分：修复数据（需要根据查询结果确认后执行）
-- ============================================

START TRANSACTION;

-- 2.1 删除错误的上传发货单（非中标供应商上传的）
-- 对于每个已中标的商品，找到真正中标的供应商，然后删除其他供应商的发货单

DELETE s FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.item_status = 'AWARDED'
  AND s.source = 'SUPPLIER'
  -- 该发货单的供应商不是真正中标的供应商
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a
    INNER JOIN quotes q ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
    INNER JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
        WHERE BINARY a.rfqId = BINARY @rfq_id
        AND a.supplierId COLLATE utf8mb4_unicode_ci = s.supplierId COLLATE utf8mb4_unicode_ci
        AND a.status != 'CANCELLED'
        AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = s.rfqItemId COLLATE utf8mb4_unicode_ci
        -- 验证该 Award 对应的 quote 中确实包含该报价项
        AND EXISTS (
            SELECT 1 
            FROM quote_items qi2 
            WHERE qi2.quoteId COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
            AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = s.rfqItemId COLLATE utf8mb4_unicode_ci
            AND qi2.id COLLATE utf8mb4_unicode_ci = qi.id COLLATE utf8mb4_unicode_ci
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
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.item_status = 'AWARDED'
  AND ri.shipmentId IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 
      FROM shipments s 
      WHERE s.id COLLATE utf8mb4_unicode_ci = ri.shipmentId COLLATE utf8mb4_unicode_ci
  );

-- 2.3 如果 RfqItem.shipmentId 指向错误的发货单（非中标供应商的），也需要清空
UPDATE rfq_items ri
INNER JOIN shipments s ON s.id COLLATE utf8mb4_unicode_ci = ri.shipmentId COLLATE utf8mb4_unicode_ci
SET 
    ri.shipmentId = NULL,
    ri.trackingNo = NULL,
    ri.carrier = NULL,
    ri.source = NULL
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.item_status = 'AWARDED'
  AND s.source = 'SUPPLIER'
  -- 该发货单的供应商不是真正中标的供应商
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a
      INNER JOIN quotes q ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
      INNER JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            WHERE BINARY a.rfqId = BINARY @rfq_id
        AND a.supplierId COLLATE utf8mb4_unicode_ci = s.supplierId COLLATE utf8mb4_unicode_ci
        AND a.status != 'CANCELLED'
        AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        -- 验证该 Award 对应的 quote 中确实包含该报价项
        AND EXISTS (
            SELECT 1 
            FROM quote_items qi2 
            WHERE qi2.quoteId COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
            AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
            AND qi2.id COLLATE utf8mb4_unicode_ci = qi.id COLLATE utf8mb4_unicode_ci
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
        WHEN s.supplierId COLLATE utf8mb4_unicode_ci = u_correct.id COLLATE utf8mb4_unicode_ci THEN '✅ 正确（中标供应商上传）'
        ELSE '❌ 仍有问题'
    END as validation
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId COLLATE utf8mb4_unicode_ci = r.id COLLATE utf8mb4_unicode_ci
-- 找到真正中标的供应商（通过 Award 记录）
-- 使用子查询确保每个 rfqItemId 只返回一个中标供应商（优先选择价格最低的）
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id as quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        a.id as award_id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
    INNER JOIN awards a ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri2.id COLLATE utf8mb4_unicode_ci
    WHERE BINARY ri2.rfqId = BINARY @rfq_id
      AND ri2.item_status = 'AWARDED'
    -- 验证该 Award 对应的 quote 中确实包含该报价项
    AND EXISTS (
        SELECT 1 
        FROM quote_items qi2 
        WHERE qi2.quoteId COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
        AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = qi.rfqItemId COLLATE utf8mb4_unicode_ci
        AND qi2.id COLLATE utf8mb4_unicode_ci = qi.id COLLATE utf8mb4_unicode_ci
    )
    -- 确保每个 rfqItemId 只返回一个记录（选择价格最低的，如果价格相同则选择最早创建的）
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON qi3.quoteId COLLATE utf8mb4_unicode_ci = q3.id COLLATE utf8mb4_unicode_ci
        INNER JOIN awards a3 ON a3.quoteId COLLATE utf8mb4_unicode_ci = q3.id COLLATE utf8mb4_unicode_ci AND a3.status != 'CANCELLED'
        INNER JOIN rfq_items ri3 ON qi3.rfqItemId COLLATE utf8mb4_unicode_ci = ri3.id COLLATE utf8mb4_unicode_ci
        WHERE BINARY ri3.rfqId = BINARY @rfq_id
          AND ri3.item_status = 'AWARDED'
          AND BINARY qi3.rfqItemId = BINARY qi.rfqItemId
          AND EXISTS (
              SELECT 1 
              FROM quote_items qi4 
              WHERE qi4.quoteId COLLATE utf8mb4_unicode_ci = a3.quoteId COLLATE utf8mb4_unicode_ci
              AND qi4.rfqItemId COLLATE utf8mb4_unicode_ci = qi3.rfqItemId COLLATE utf8mb4_unicode_ci
              AND qi4.id COLLATE utf8mb4_unicode_ci = qi3.id COLLATE utf8mb4_unicode_ci
          )
        ORDER BY qi3.price ASC, qi3.id ASC
        LIMIT 1
    )
) as correct_award ON correct_award.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
LEFT JOIN users u_correct ON correct_award.supplierId COLLATE utf8mb4_unicode_ci = u_correct.id COLLATE utf8mb4_unicode_ci
LEFT JOIN quote_items qi_correct ON correct_award.quote_item_id COLLATE utf8mb4_unicode_ci = qi_correct.id COLLATE utf8mb4_unicode_ci
LEFT JOIN awards a_correct ON correct_award.award_id COLLATE utf8mb4_unicode_ci = a_correct.id COLLATE utf8mb4_unicode_ci
-- 查找发货单
LEFT JOIN shipments s ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci AND s.source = 'SUPPLIER'
LEFT JOIN users u_shipment ON s.supplierId COLLATE utf8mb4_unicode_ci = u_shipment.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.item_status = 'AWARDED'
ORDER BY ri.productName;

-- 3.2 检查是否还有错误的发货单
SELECT 
    '=== 检查是否还有错误的发货单 ===' as section;

SELECT 
    COUNT(*) as wrong_shipment_count
FROM shipments s
INNER JOIN rfq_items ri ON s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.item_status = 'AWARDED'
  AND s.source = 'SUPPLIER'
  -- 该发货单的供应商不是真正中标的供应商
  AND NOT EXISTS (
      SELECT 1 
      FROM awards a
    INNER JOIN quotes q ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
    INNER JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
        WHERE BINARY a.rfqId = BINARY @rfq_id
        AND a.supplierId COLLATE utf8mb4_unicode_ci = s.supplierId COLLATE utf8mb4_unicode_ci
        AND a.status != 'CANCELLED'
        AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = s.rfqItemId COLLATE utf8mb4_unicode_ci
        -- 验证该 Award 对应的 quote 中确实包含该报价项
        AND EXISTS (
            SELECT 1 
            FROM quote_items qi2 
            WHERE qi2.quoteId COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
            AND qi2.rfqItemId COLLATE utf8mb4_unicode_ci = s.rfqItemId COLLATE utf8mb4_unicode_ci
            AND qi2.id COLLATE utf8mb4_unicode_ci = qi.id COLLATE utf8mb4_unicode_ci
        )
  );

-- 如果验证通过，执行 COMMIT;
-- 如果需要回滚，执行 ROLLBACK;
-- COMMIT;
-- ROLLBACK;

