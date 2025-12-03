-- 修复错误中标且已上传快递单号的情况
-- 注意：执行前请先运行 check-wrong-awards-with-shipments.sql 查看数据
-- 
-- 修复策略：
-- 1. 删除错误供应商上传的发货单（shipments）
-- 2. 清除 rfq_items 中关联的错误 shipmentId 和 trackingNo
-- 3. 确保正确的供应商可以重新上传快递单号

-- ============================================
-- 第一部分：设置变量（可选，用于修复特定 RFQ）
-- ============================================

-- 如果要修复特定 RFQ，取消下面的注释并设置 RFQ 编号
-- SET @rfq_no = 'RFQ-1764735881464';
-- SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);

-- ============================================
-- 第二部分：查看需要修复的数据
-- ============================================

SELECT '=== 需要修复的数据 ===' AS section;

SELECT 
    r.rfqNo,
    ri.id AS rfq_item_id,
    ri.productName,
    u_correct.username AS correct_supplier,
    u_shipment.username AS wrong_supplier,
    s.id AS wrong_shipment_id,
    s.shipmentNo,
    s.trackingNo AS wrong_tracking_no,
    ri.trackingNo AS rfq_item_tracking_no
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
        q.submittedAt,
        a.id AS award_id,
        a.status AS award_status
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    LEFT JOIN awards a ON BINARY a.quoteId = BINARY q.id 
        AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
    WHERE qi.id = (
        SELECT qi2.id
        FROM quote_items qi2
        INNER JOIN quotes q2 ON BINARY qi2.quoteId = BINARY q2.id
        LEFT JOIN awards a2 ON BINARY a2.quoteId = BINARY q2.id 
            AND a2.status != 'CANCELLED'
        WHERE BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        ORDER BY 
            CASE WHEN a2.id IS NOT NULL THEN 0 ELSE 1 END,
            qi2.price ASC,
            q2.submittedAt ASC
        LIMIT 1
    )
) AS correct_quote ON BINARY correct_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_correct ON BINARY u_correct.id = BINARY correct_quote.supplierId
-- 找到上传快递单号的供应商
LEFT JOIN shipments s ON BINARY s.id = BINARY ri.shipmentId
LEFT JOIN users u_shipment ON BINARY s.supplierId = BINARY u_shipment.id
WHERE ri.item_status = 'AWARDED'
  AND ri.trackingNo IS NOT NULL
  AND u_correct.id IS NOT NULL 
  AND u_shipment.id IS NOT NULL
  AND BINARY u_correct.id != BINARY u_shipment.id
  -- 如果指定了 RFQ，只修复该 RFQ
  AND (@rfq_id IS NULL OR BINARY ri.rfqId = BINARY @rfq_id)
ORDER BY r.rfqNo DESC, ri.productName;

-- ============================================
-- 第三部分：开始修复
-- ============================================

SET autocommit = 0;
START TRANSACTION;

-- 3.1 删除错误供应商上传的发货单
DELETE s FROM shipments s
INNER JOIN rfq_items ri ON BINARY s.rfqItemId = BINARY ri.id
INNER JOIN rfqs r ON BINARY ri.rfqId = BINARY r.id
-- 找到真正中标的供应商
INNER JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id AS quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        q.submittedAt,
        a.id AS award_id,
        a.status AS award_status
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    LEFT JOIN awards a ON BINARY a.quoteId = BINARY q.id 
        AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
    WHERE qi.id = (
        SELECT qi2.id
        FROM quote_items qi2
        INNER JOIN quotes q2 ON BINARY qi2.quoteId = BINARY q2.id
        LEFT JOIN awards a2 ON BINARY a2.quoteId = BINARY q2.id 
            AND a2.status != 'CANCELLED'
        WHERE BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        ORDER BY 
            CASE WHEN a2.id IS NOT NULL THEN 0 ELSE 1 END,
            qi2.price ASC,
            q2.submittedAt ASC
        LIMIT 1
    )
) AS correct_quote ON BINARY correct_quote.rfqItemId = BINARY ri.id
INNER JOIN users u_correct ON BINARY u_correct.id = BINARY correct_quote.supplierId
WHERE ri.item_status = 'AWARDED'
  AND ri.trackingNo IS NOT NULL
  AND s.supplierId IS NOT NULL
  AND BINARY s.supplierId != BINARY u_correct.id
  AND (@rfq_id IS NULL OR BINARY ri.rfqId = BINARY @rfq_id);

SELECT CONCAT('已删除 ', ROW_COUNT(), ' 个错误供应商的发货单') AS message;

-- 3.2 清除 rfq_items 中关联的错误 shipmentId 和 trackingNo
UPDATE rfq_items ri
INNER JOIN rfqs r ON BINARY ri.rfqId = BINARY r.id
-- 找到真正中标的供应商
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id AS quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        q.submittedAt,
        a.id AS award_id,
        a.status AS award_status
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    LEFT JOIN awards a ON BINARY a.quoteId = BINARY q.id 
        AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
    WHERE qi.id = (
        SELECT qi2.id
        FROM quote_items qi2
        INNER JOIN quotes q2 ON BINARY qi2.quoteId = BINARY q2.id
        LEFT JOIN awards a2 ON BINARY a2.quoteId = BINARY q2.id 
            AND a2.status != 'CANCELLED'
        WHERE BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        ORDER BY 
            CASE WHEN a2.id IS NOT NULL THEN 0 ELSE 1 END,
            qi2.price ASC,
            q2.submittedAt ASC
        LIMIT 1
    )
) AS correct_quote ON BINARY correct_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_correct ON BINARY u_correct.id = BINARY correct_quote.supplierId
LEFT JOIN shipments s ON BINARY s.id = BINARY ri.shipmentId
LEFT JOIN users u_shipment ON BINARY s.supplierId = BINARY u_shipment.id
SET 
    ri.shipmentId = NULL,
    ri.trackingNo = NULL,
    ri.carrier = NULL,
    ri.source = NULL
WHERE ri.item_status = 'AWARDED'
  AND ri.trackingNo IS NOT NULL
  AND u_correct.id IS NOT NULL
  AND (
      -- 情况1：shipmentId 指向已删除的发货单
      (ri.shipmentId IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM shipments s2 
          WHERE BINARY s2.id = BINARY ri.shipmentId
      ))
      OR
      -- 情况2：shipmentId 指向错误供应商的发货单
      (s.id IS NOT NULL AND BINARY s.supplierId != BINARY u_correct.id)
  )
  AND (@rfq_id IS NULL OR BINARY ri.rfqId = BINARY @rfq_id);

SELECT CONCAT('已清除 ', ROW_COUNT(), ' 个商品的错误快递单号信息') AS message;

-- ============================================
-- 第四部分：验证修复结果
-- ============================================

SELECT '=== 修复后的验证 ===' AS section;

SELECT 
    r.rfqNo,
    ri.id AS rfq_item_id,
    ri.productName,
    u_correct.username AS correct_supplier,
    ri.trackingNo,
    ri.shipmentId,
    CASE 
        WHEN ri.trackingNo IS NULL THEN '✅ 已清除，正确供应商可以重新上传'
        WHEN ri.shipmentId IS NOT NULL AND EXISTS (
            SELECT 1 FROM shipments s 
            WHERE BINARY s.id = BINARY ri.shipmentId
            AND BINARY s.supplierId = BINARY u_correct.id
        ) THEN '✅ 正确（中标供应商上传）'
        ELSE '⚠️ 需要检查'
    END AS validation_status
FROM rfq_items ri
INNER JOIN rfqs r ON BINARY ri.rfqId = BINARY r.id
LEFT JOIN (
    SELECT 
        qi.rfqItemId,
        qi.id AS quote_item_id,
        qi.quoteId,
        qi.price,
        q.supplierId,
        q.submittedAt,
        a.id AS award_id,
        a.status AS award_status
    FROM quote_items qi
    INNER JOIN quotes q ON BINARY qi.quoteId = BINARY q.id
    LEFT JOIN awards a ON BINARY a.quoteId = BINARY q.id 
        AND a.status != 'CANCELLED'
    INNER JOIN rfq_items ri2 ON BINARY ri2.id = BINARY qi.rfqItemId 
        AND ri2.item_status = 'AWARDED'
    WHERE qi.id = (
        SELECT qi2.id
        FROM quote_items qi2
        INNER JOIN quotes q2 ON BINARY qi2.quoteId = BINARY q2.id
        LEFT JOIN awards a2 ON BINARY a2.quoteId = BINARY q2.id 
            AND a2.status != 'CANCELLED'
        WHERE BINARY qi2.rfqItemId = BINARY qi.rfqItemId
        ORDER BY 
            CASE WHEN a2.id IS NOT NULL THEN 0 ELSE 1 END,
            qi2.price ASC,
            q2.submittedAt ASC
        LIMIT 1
    )
) AS correct_quote ON BINARY correct_quote.rfqItemId = BINARY ri.id
LEFT JOIN users u_correct ON BINARY u_correct.id = BINARY correct_quote.supplierId
WHERE ri.item_status = 'AWARDED'
  AND (@rfq_id IS NULL OR BINARY ri.rfqId = BINARY @rfq_id)
ORDER BY r.rfqNo DESC, ri.productName;

-- 提交事务
COMMIT;

SELECT '=== 修复完成 ===' AS section;
SELECT '请检查上述结果，确认无误。如果发现问题，可以执行 ROLLBACK; 回滚事务。' AS notice;
