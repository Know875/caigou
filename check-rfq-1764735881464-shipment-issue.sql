-- 检查 RFQ-1764735881464 的发货单问题
SET @rfq_no = 'RFQ-1764735881464';
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);

SELECT '=== 问题分析：MG沙扎比和MG重炮手的发货单 ===' AS section;

-- MG沙扎比：应该是赛罗中标，但 rfq_items 中有 trackingNo 但没有 shipmentId
-- MG重炮手：应该是菜狗中标，但 rfq_items 中有 trackingNo 但没有 shipmentId
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.item_status,
    ri.trackingNo,
    ri.carrier,
    ri.source,
    ri.shipmentId,
    -- 中标供应商
    u_award.username AS award_supplier,
    qi_award.price AS award_price,
    a_award.id AS award_id,
    -- 发货单信息
    s.id AS shipment_id,
    s.shipmentNo,
    u_shipment.username AS shipment_supplier,
    s.trackingNo AS shipment_tracking_no,
    s.carrier AS shipment_carrier,
    s.source AS shipment_source,
    -- 判断
    CASE 
        WHEN ri.trackingNo IS NOT NULL AND ri.shipmentId IS NULL THEN '⚠️ 有 trackingNo 但没有 shipmentId（可能是错误数据）'
        WHEN s.id IS NOT NULL AND BINARY u_award.id != BINARY u_shipment.id THEN '❌ 发货单供应商与中标供应商不一致'
        WHEN s.id IS NOT NULL AND BINARY u_award.id = BINARY u_shipment.id THEN '✅ 正确'
        WHEN ri.trackingNo IS NULL THEN '✅ 无发货单'
        ELSE '⚠️ 需要检查'
    END AS issue
FROM rfq_items ri
-- 通过 Award 记录找到中标供应商
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        q.supplierId,
        qi.price,
        a.id AS award_id
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    INNER JOIN awards a ON BINARY a.quoteId = BINARY q.id
        AND a.status = 'ACTIVE'
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
        AND BINARY ri2.rfqId = BINARY @rfq_id
    )
    AND EXISTS (
        SELECT 1 FROM quote_items qi2
        WHERE BINARY qi2.quoteId = BINARY a.quoteId
        AND BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        AND BINARY qi2.id = BINARY qi.id
    )
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON BINARY qi3.quoteId = BINARY q3.id
        INNER JOIN awards a3 ON BINARY a3.quoteId = BINARY q3.id
            AND a3.status = 'ACTIVE'
        WHERE BINARY qi3.rfqItemId = BINARY qi.rfqItemId
        ORDER BY qi3.price ASC, q3.submittedAt ASC
        LIMIT 1
    )
) AS award_quote ON BINARY award_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_award ON BINARY u_award.id = BINARY award_quote.supplierId
LEFT JOIN quote_items qi_award ON BINARY qi_award.rfqItemId = BINARY ri.id 
    AND BINARY qi_award.quoteId = BINARY (SELECT quoteId FROM awards WHERE BINARY id = BINARY award_quote.award_id LIMIT 1)
LEFT JOIN awards a_award ON BINARY a_award.id = BINARY award_quote.award_id
-- 发货单信息
LEFT JOIN shipments s ON BINARY s.rfqItemId = BINARY ri.id
LEFT JOIN users u_shipment ON BINARY s.supplierId = BINARY u_shipment.id
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.item_status = 'AWARDED'
  AND (
      -- 有 trackingNo 但没有 shipmentId
      (ri.trackingNo IS NOT NULL AND ri.shipmentId IS NULL)
      OR
      -- 或者发货单供应商与中标供应商不一致
      (s.id IS NOT NULL AND u_award.id IS NOT NULL AND BINARY u_award.id != BINARY u_shipment.id)
  )
ORDER BY ri.productName;

SELECT '=== 所有有 trackingNo 但没有 shipmentId 的商品 ===' AS section;
SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    ri.trackingNo,
    ri.carrier,
    ri.source,
    ri.shipmentId,
    u_award.username AS award_supplier
FROM rfq_items ri
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        q.supplierId
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    INNER JOIN awards a ON BINARY a.quoteId = BINARY q.id
        AND a.status = 'ACTIVE'
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
        AND BINARY ri2.rfqId = BINARY @rfq_id
    )
    AND EXISTS (
        SELECT 1 FROM quote_items qi2
        WHERE BINARY qi2.quoteId = BINARY a.quoteId
        AND BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        AND BINARY qi2.id = BINARY qi.id
    )
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON BINARY qi3.quoteId = BINARY q3.id
        INNER JOIN awards a3 ON BINARY a3.quoteId = BINARY q3.id
            AND a3.status = 'ACTIVE'
        WHERE BINARY qi3.rfqItemId = BINARY qi.rfqItemId
        ORDER BY qi3.price ASC, q3.submittedAt ASC
        LIMIT 1
    )
) AS award_quote ON BINARY award_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_award ON BINARY u_award.id = BINARY award_quote.supplierId
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND ri.trackingNo IS NOT NULL
  AND ri.shipmentId IS NULL;

SELECT '=== 检查是否有错误供应商的发货单 ===' AS section;
SELECT 
    s.id AS shipment_id,
    s.shipmentNo,
    ri.productName,
    u_shipment.username AS shipment_supplier,
    u_award.username AS award_supplier,
    s.trackingNo,
    s.carrier,
    s.source,
    s.status,
    s.createdAt
FROM shipments s
INNER JOIN rfq_items ri ON BINARY s.rfqItemId = BINARY ri.id
LEFT JOIN users u_shipment ON BINARY s.supplierId = BINARY u_shipment.id
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        q.supplierId
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    INNER JOIN awards a ON BINARY a.quoteId = BINARY q.id
        AND a.status = 'ACTIVE'
    WHERE EXISTS (
        SELECT 1 FROM rfq_items ri2 
        WHERE BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
        AND BINARY ri2.rfqId = BINARY @rfq_id
    )
    AND EXISTS (
        SELECT 1 FROM quote_items qi2
        WHERE BINARY qi2.quoteId = BINARY a.quoteId
        AND BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        AND BINARY qi2.id = BINARY qi.id
    )
    AND qi.id = (
        SELECT qi3.id
        FROM quote_items qi3
        INNER JOIN quotes q3 ON BINARY qi3.quoteId = BINARY q3.id
        INNER JOIN awards a3 ON BINARY a3.quoteId = BINARY q3.id
            AND a3.status = 'ACTIVE'
        WHERE BINARY qi3.rfqItemId = BINARY qi.rfqItemId
        ORDER BY qi3.price ASC, q3.submittedAt ASC
        LIMIT 1
    )
) AS award_quote ON BINARY award_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_award ON BINARY u_award.id = BINARY award_quote.supplierId
WHERE BINARY ri.rfqId = BINARY @rfq_id
  AND u_award.id IS NOT NULL
  AND u_shipment.id IS NOT NULL
  AND BINARY u_award.id != BINARY u_shipment.id;

