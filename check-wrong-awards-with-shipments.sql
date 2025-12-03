-- 检查所有错误中标且已上传快递单号的情况
-- 用于找出财务报表中显示错误的数据

-- ============================================
-- 第一部分：查找所有有问题的 RFQ
-- ============================================

SELECT '=== 查找所有有问题的 RFQ（错误中标且已上传快递单号） ===' AS section;

SELECT 
    r.rfqNo,
    r.id AS rfq_id,
    r.title,
    r.status AS rfq_status,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' AND ri.trackingNo IS NOT NULL THEN ri.id END) AS awarded_with_tracking_count,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' THEN ri.id END) AS awarded_item_count
FROM rfqs r
INNER JOIN rfq_items ri ON ri.rfqId = r.id
WHERE ri.item_status = 'AWARDED'
  AND ri.trackingNo IS NOT NULL
GROUP BY r.id, r.rfqNo, r.title, r.status
HAVING COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' AND ri.trackingNo IS NOT NULL THEN ri.id END) > 0
ORDER BY r.rfqNo DESC
LIMIT 20;

-- ============================================
-- 第二部分：详细检查每个有问题的商品
-- ============================================

SELECT '=== 详细检查：错误中标且已上传快递单号的商品 ===' AS section;

SELECT 
    r.rfqNo,
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.trackingNo,
    ri.carrier,
    ri.shipmentId,
    -- 真正中标的供应商（通过 Award 记录或最低价确定）
    u_correct.username AS correct_supplier,
    qi_correct.price AS correct_price,
    a_correct.id AS correct_award_id,
    a_correct.status AS correct_award_status,
    -- 上传快递单号的供应商
    u_shipment.username AS shipment_supplier,
    s.id AS shipment_id,
    s.shipmentNo,
    s.trackingNo AS shipment_tracking_no,
    s.carrier AS shipment_carrier,
    s.status AS shipment_status,
    s.createdAt AS shipment_created_at,
    -- 判断是否正确
    CASE 
        WHEN u_correct.id IS NULL THEN '⚠️ 无法确定正确供应商'
        WHEN u_shipment.id IS NULL THEN '⚠️ 无法确定上传供应商'
        WHEN BINARY u_correct.id = BINARY u_shipment.id THEN '✅ 正确（中标供应商上传）'
        WHEN BINARY u_correct.id != BINARY u_shipment.id THEN '❌ 错误（非中标供应商上传）'
        ELSE '⚠️ 需要检查'
    END AS validation_status
FROM rfq_items ri
INNER JOIN rfqs r ON BINARY ri.rfqId = BINARY r.id
-- 找到真正中标的供应商（优先通过 Award 记录）
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id AS quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        a.id AS award_id,
        a.status AS award_status,
        ROW_NUMBER() OVER (
            PARTITION BY qi.rfqItemId 
            ORDER BY 
                CASE WHEN a.status != 'CANCELLED' THEN 0 ELSE 1 END,  -- 优先选择 ACTIVE Award
                qi.price ASC,  -- 价格最低
                q.submittedAt ASC  -- 最早提交
        ) AS rn
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    LEFT JOIN awards a ON BINARY a.quoteId = BINARY q.id 
        AND a.status != 'CANCELLED'
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
    )
) AS correct_quote ON BINARY correct_quote.rfqItemId = BINARY ri.id 
    AND correct_quote.rn = 1
LEFT JOIN users u_correct ON BINARY u_correct.id = BINARY correct_quote.supplierId
LEFT JOIN quote_items qi_correct ON BINARY qi_correct.id = BINARY correct_quote.quote_item_id
LEFT JOIN awards a_correct ON BINARY a_correct.id = BINARY correct_quote.award_id
-- 找到上传快递单号的供应商（通过 shipment 或 rfq_item 的 trackingNo）
LEFT JOIN shipments s ON BINARY s.id = BINARY ri.shipmentId
LEFT JOIN users u_shipment ON (
    (BINARY s.supplierId = BINARY u_shipment.id)
    OR (s.id IS NULL AND ri.trackingNo IS NOT NULL AND EXISTS (
        -- 如果 rfq_item 有 trackingNo 但没有 shipmentId，尝试通过其他方式找到供应商
        SELECT 1 FROM shipments s2 
        INNER JOIN rfq_items ri2 ON BINARY s2.rfqItemId = BINARY ri2.id
        WHERE BINARY ri2.id = BINARY ri.id
        AND s2.trackingNo = ri.trackingNo
        AND BINARY s2.supplierId = BINARY u_shipment.id
    ))
)
WHERE ri.item_status = 'AWARDED'
  AND ri.trackingNo IS NOT NULL
  AND (
      -- 错误的情况：上传供应商与中标供应商不一致
      (u_correct.id IS NOT NULL AND u_shipment.id IS NOT NULL AND BINARY u_correct.id != BINARY u_shipment.id)
      OR
      -- 或者无法确定正确供应商
      u_correct.id IS NULL
  )
ORDER BY r.rfqNo DESC, ri.productName
LIMIT 50;

-- ============================================
-- 第三部分：统计错误数量
-- ============================================

SELECT '=== 统计错误数量 ===' AS section;

SELECT 
    COUNT(*) AS total_wrong_count,
    COUNT(DISTINCT r.id) AS affected_rfq_count
FROM rfq_items ri
INNER JOIN rfqs r ON BINARY ri.rfqId = BINARY r.id
-- 找到真正中标的供应商
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id AS quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        a.id AS award_id,
        a.status AS award_status,
        ROW_NUMBER() OVER (
            PARTITION BY qi.rfqItemId 
            ORDER BY 
                CASE WHEN a.status != 'CANCELLED' THEN 0 ELSE 1 END,
                qi.price ASC,
                q.submittedAt ASC
        ) AS rn
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    LEFT JOIN awards a ON BINARY a.quoteId = BINARY q.id 
        AND a.status != 'CANCELLED'
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
    )
) AS correct_quote ON BINARY correct_quote.rfqItemId = BINARY ri.id 
    AND correct_quote.rn = 1
LEFT JOIN users u_correct ON BINARY u_correct.id = BINARY correct_quote.supplierId
-- 找到上传快递单号的供应商
LEFT JOIN shipments s ON BINARY s.id = BINARY ri.shipmentId
LEFT JOIN users u_shipment ON BINARY s.supplierId = BINARY u_shipment.id
WHERE ri.item_status = 'AWARDED'
  AND ri.trackingNo IS NOT NULL
  AND u_correct.id IS NOT NULL 
  AND u_shipment.id IS NOT NULL
  AND BINARY u_correct.id != BINARY u_shipment.id;

