-- 修复 RFQ-1764574989800 中 3 个 RFQ Item 的问题：
-- 1. 有 trackingNo 但没有 SUPPLIER 发货单
-- 2. 有多个 ACTIVE 的 Award（应该只有一个）

SET @rfq_no = 'RFQ-1764574989800' COLLATE utf8mb4_unicode_ci;
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo COLLATE utf8mb4_unicode_ci = @rfq_no COLLATE utf8mb4_unicode_ci);

-- 需要修复的 3 个 RFQ Item
SET @item1 = 'cmimue03d001ikqi6yqh3e06n' COLLATE utf8mb4_unicode_ci;
SET @item2 = 'cmimue03d001hkqi6mfqsv0qv' COLLATE utf8mb4_unicode_ci;
SET @item3 = 'cmimue03d001gkqi6fvbx7kc1' COLLATE utf8mb4_unicode_ci;

-- 正确的供应商（赛罗，价格更低，提交时间更早）
SET @correct_supplier_id = 'cmihdr4dx000akqu5rp81kww7';
SET @correct_supplier_name = '赛罗';

-- 错误的供应商（豪，价格更高，提交时间更晚）
SET @wrong_supplier_id = 'cmigt03fg0000kq0jnqo4h92x';
SET @wrong_supplier_name = '豪';

-- 开始事务
SET autocommit = 0;
START TRANSACTION;

-- ============================================
-- 1. 查看修复前的状态
-- ============================================
SELECT 
    '=== 修复前的状态 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.trackingNo,
    ri.shipmentId,
    -- Award 数量
    (
        SELECT COUNT(*)
        FROM awards a
        WHERE a.rfqId COLLATE utf8mb4_unicode_ci = BINARY @rfq_id
        AND a.status = 'ACTIVE'
        AND EXISTS (
            SELECT 1
            FROM quotes q
            INNER JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            WHERE q.id COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
            AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        )
    ) as active_award_count,
    -- 发货单数量
    (
        SELECT COUNT(*)
        FROM shipments s
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        AND s.source = 'SUPPLIER'
    ) as supplier_shipment_count
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
AND (ri.id COLLATE utf8mb4_unicode_ci = @item1 
     OR ri.id COLLATE utf8mb4_unicode_ci = @item2 
     OR ri.id COLLATE utf8mb4_unicode_ci = @item3)
ORDER BY ri.id;

-- ============================================
-- 2. 取消错误的 Award（豪的 Award）
-- ============================================
SELECT 
    '=== 取消错误的 Award（豪） ===' as section;

-- 找到豪的 Award ID
SET @wrong_award_id = (
    SELECT a.id
    FROM awards a
    INNER JOIN quotes q ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
    WHERE BINARY a.rfqId = BINARY @rfq_id
    AND a.supplierId COLLATE utf8mb4_unicode_ci = @wrong_supplier_id COLLATE utf8mb4_unicode_ci
    AND a.status = 'ACTIVE'
        AND EXISTS (
            SELECT 1
            FROM quote_items qi
            WHERE qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            AND (qi.rfqItemId COLLATE utf8mb4_unicode_ci = @item1 
                 OR qi.rfqItemId COLLATE utf8mb4_unicode_ci = @item2 
                 OR qi.rfqItemId COLLATE utf8mb4_unicode_ci = @item3)
        )
    LIMIT 1
);

SELECT 
    @wrong_award_id as wrong_award_id,
    CASE 
        WHEN @wrong_award_id IS NULL THEN '❌ 未找到错误的 Award'
        ELSE '✅ 找到错误的 Award'
    END as status;

-- 取消错误的 Award
UPDATE awards
SET status = 'CANCELLED',
    updatedAt = NOW()
WHERE id COLLATE utf8mb4_unicode_ci = @wrong_award_id COLLATE utf8mb4_unicode_ci
AND status = 'ACTIVE';

SELECT 
    ROW_COUNT() as cancelled_award_count,
    CASE 
        WHEN ROW_COUNT() > 0 THEN '✅ 已取消错误的 Award'
        ELSE '⚠️ 没有取消任何 Award（可能已经被取消）'
    END as status;

-- ============================================
-- 3. 清除错误的 trackingNo（因为不是通过供应商上传创建的）
-- ============================================
SELECT 
    '=== 清除错误的 trackingNo ===' as section;

-- 清除这 3 个 RFQ Item 的 trackingNo、carrier 和 shipmentId
UPDATE rfq_items
SET trackingNo = NULL,
    carrier = NULL,
    shipmentId = NULL,
    updatedAt = NOW()
WHERE (id COLLATE utf8mb4_unicode_ci = @item1 
       OR id COLLATE utf8mb4_unicode_ci = @item2 
       OR id COLLATE utf8mb4_unicode_ci = @item3)
AND trackingNo IS NOT NULL;

SELECT 
    ROW_COUNT() as cleared_rfq_items_count,
    CASE 
        WHEN ROW_COUNT() > 0 THEN '✅ 已清除错误的 trackingNo'
        ELSE '⚠️ 没有清除任何 trackingNo（可能已经被清除）'
    END as status;

-- ============================================
-- 4. 查看修复后的状态
-- ============================================
SELECT 
    '=== 修复后的状态 ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    ri.trackingNo,
    ri.shipmentId,
    -- Award 数量
    (
        SELECT COUNT(*)
        FROM awards a
        WHERE a.rfqId COLLATE utf8mb4_unicode_ci = BINARY @rfq_id
        AND a.status = 'ACTIVE'
        AND EXISTS (
            SELECT 1
            FROM quotes q
            INNER JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            WHERE q.id COLLATE utf8mb4_unicode_ci = a.quoteId COLLATE utf8mb4_unicode_ci
            AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        )
    ) as active_award_count,
    -- 发货单数量
    (
        SELECT COUNT(*)
        FROM shipments s
        WHERE s.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        AND s.source = 'SUPPLIER'
    ) as supplier_shipment_count,
    -- 正确的供应商
    (
        SELECT u.username
        FROM awards a
        INNER JOIN quotes q ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
        INNER JOIN quote_items qi ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
        INNER JOIN users u ON a.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
        WHERE BINARY a.rfqId = BINARY @rfq_id
        AND a.status = 'ACTIVE'
        AND qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
        ORDER BY qi.price ASC, q.submittedAt ASC
        LIMIT 1
    ) as correct_supplier
FROM rfq_items ri
WHERE BINARY ri.rfqId = BINARY @rfq_id
AND (ri.id COLLATE utf8mb4_unicode_ci = @item1 
     OR ri.id COLLATE utf8mb4_unicode_ci = @item2 
     OR ri.id COLLATE utf8mb4_unicode_ci = @item3)
ORDER BY ri.id;

-- ============================================
-- 5. 验证：检查是否还有多个 ACTIVE 的 Award
-- ============================================
SELECT 
    '=== 验证：检查是否还有多个 ACTIVE 的 Award ===' as section;

SELECT 
    ri.id as rfq_item_id,
    ri.productName,
    COUNT(DISTINCT a.id) as active_award_count,
    GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') as suppliers
FROM rfq_items ri
INNER JOIN quote_items qi ON qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
INNER JOIN quotes q ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
INNER JOIN awards a ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
INNER JOIN users u ON a.supplierId COLLATE utf8mb4_unicode_ci = u.id COLLATE utf8mb4_unicode_ci
WHERE BINARY ri.rfqId = BINARY @rfq_id
AND (ri.id COLLATE utf8mb4_unicode_ci = @item1 
     OR ri.id COLLATE utf8mb4_unicode_ci = @item2 
     OR ri.id COLLATE utf8mb4_unicode_ci = @item3)
AND a.status = 'ACTIVE'
GROUP BY ri.id, ri.productName
HAVING COUNT(DISTINCT a.id) > 1;

-- 如果没有结果，说明修复成功
SELECT 
    CASE 
        WHEN NOT EXISTS (
            SELECT 1
            FROM rfq_items ri
            INNER JOIN quote_items qi ON qi.rfqItemId COLLATE utf8mb4_unicode_ci = ri.id COLLATE utf8mb4_unicode_ci
            INNER JOIN quotes q ON qi.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            INNER JOIN awards a ON a.quoteId COLLATE utf8mb4_unicode_ci = q.id COLLATE utf8mb4_unicode_ci
            WHERE BINARY ri.rfqId = BINARY @rfq_id
            AND (ri.id COLLATE utf8mb4_unicode_ci = @item1 
                 OR ri.id COLLATE utf8mb4_unicode_ci = @item2 
                 OR ri.id COLLATE utf8mb4_unicode_ci = @item3)
            AND a.status = 'ACTIVE'
            GROUP BY ri.id
            HAVING COUNT(DISTINCT a.id) > 1
        ) THEN '✅ 验证通过：没有多个 ACTIVE 的 Award'
        ELSE '❌ 验证失败：仍有多个 ACTIVE 的 Award'
    END as validation_result;

-- ============================================
-- 6. 提交或回滚
-- ============================================
-- 请检查上面的结果，如果一切正常，执行：
-- COMMIT;
-- 
-- 如果有问题，执行：
-- ROLLBACK;

SELECT 
    '=== 修复完成，请检查上面的结果 ===' as section,
    '如果一切正常，请执行: COMMIT;' as next_step,
    '如果有问题，请执行: ROLLBACK;' as rollback_step;

