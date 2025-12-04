-- 修复 RFQ-1764735881464：将 MEGA独角兽 和 MG沙扎比 的中标改为赛罗
-- 因为已经发货，只能按现状修改

SET @rfq_no = 'RFQ-1764735881464';
SET @rfq_id = (SELECT id FROM rfqs WHERE rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci);
SET @sailuo_id = (SELECT id FROM users WHERE username = '赛罗' COLLATE utf8mb4_unicode_ci);

SET autocommit = 0;
START TRANSACTION;

SELECT '=== 开始修复：将 MEGA独角兽 和 MG沙扎比 的中标改为赛罗 ===' AS section;

-- 1. MEGA独角兽 (cmipi6gwf000dkq9fnqnu6bp5)
SELECT '=== 修复 MEGA独角兽 ===' AS section;

-- 查找赛罗对该商品的报价
SELECT 
    qi.id AS quote_item_id,
    q.id AS quote_id,
    u.username AS supplier_name,
    qi.price,
    q.status AS quote_status
FROM quote_items qi
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
WHERE qi.rfqItemId = 'cmipi6gwf000dkq9fnqnu6bp5'
  AND q.rfqId = @rfq_id
  AND u.username = '赛罗' COLLATE utf8mb4_unicode_ci;

-- 取消其他供应商对 MEGA独角兽 的 Award（如果存在）
UPDATE awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
SET a.status = 'CANCELLED',
    a.cancellation_reason = 'MANUAL_REAWARD',
    a.cancelled_at = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status = 'ACTIVE'
  AND qi.rfqItemId = 'cmipi6gwf000dkq9fnqnu6bp5'
  AND q.supplierId != @sailuo_id;

-- 确保赛罗有 Award（如果还没有，需要创建）
-- 先查找赛罗的 Quote ID（用于 MEGA独角兽 或 MG沙扎比）
SET @sailuo_quote_id = (
    SELECT q.id 
    FROM quotes q
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    WHERE q.rfqId = @rfq_id
      AND q.supplierId = @sailuo_id
      AND qi.rfqItemId IN ('cmipi6gwf000dkq9fnqnu6bp5', 'cmipi6gwf000jkq9f9vxch2p0')
    ORDER BY q.submittedAt ASC
    LIMIT 1
);

-- 如果赛罗还没有 Award，创建一个
INSERT INTO awards (id, rfqId, quoteId, supplierId, finalPrice, reason, status, createdAt, updatedAt)
SELECT 
    CONCAT('cmip', SUBSTRING(MD5(CONCAT(@rfq_id, @sailuo_id, NOW())), 1, 21)) AS id,
    @rfq_id AS rfqId,
    @sailuo_quote_id AS quoteId,
    @sailuo_id AS supplierId,
    0 AS finalPrice,  -- 稍后会更新
    '手动修复：将 MEGA独角兽 和 MG沙扎比 的中标改为赛罗' AS reason,
    'ACTIVE' AS status,
    NOW() AS createdAt,
    NOW() AS updatedAt
WHERE NOT EXISTS (
    SELECT 1 FROM awards a2
    WHERE a2.rfqId = @rfq_id
      AND a2.supplierId = @sailuo_id
      AND a2.status = 'ACTIVE'
);

-- 如果赛罗已有 Award，更新状态为 ACTIVE（如果被取消了）
UPDATE awards
SET status = 'ACTIVE',
    cancellation_reason = NULL,
    cancelled_at = NULL,
    reason = '手动修复：将 MEGA独角兽 和 MG沙扎比 的中标改为赛罗',
    updatedAt = NOW()
WHERE rfqId = @rfq_id
  AND supplierId = @sailuo_id
  AND status = 'CANCELLED';

-- 2. MG沙扎比 (cmipi6gwf000jkq9f9vxch2p0)
SELECT '=== 修复 MG沙扎比 ===' AS section;

-- 取消其他供应商对 MG沙扎比 的 Award（如果存在）
UPDATE awards a
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
SET a.status = 'CANCELLED',
    a.cancellation_reason = 'MANUAL_REAWARD',
    a.cancelled_at = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status = 'ACTIVE'
  AND qi.rfqItemId = 'cmipi6gwf000jkq9f9vxch2p0'
  AND q.supplierId != @sailuo_id;

-- 3. 更新赛罗的 Award 的 finalPrice（计算 MEGA独角兽 和 MG沙扎比 的价格）
SELECT '=== 更新赛罗的 Award finalPrice ===' AS section;

UPDATE awards a
INNER JOIN (
    SELECT 
        @sailuo_id AS supplier_id,
        SUM(qi.price * COALESCE(ri.quantity, 1)) AS total_price,
        COUNT(DISTINCT qi.rfqItemId) AS item_count,
        GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE q.rfqId = @rfq_id
      AND q.supplierId = @sailuo_id
      AND qi.rfqItemId IN ('cmipi6gwf000dkq9fnqnu6bp5', 'cmipi6gwf000jkq9f9vxch2p0')
      AND ri.item_status = 'AWARDED'
) AS calc ON a.supplierId = calc.supplier_id
SET a.finalPrice = calc.total_price,
    a.reason = CONCAT('手动修复：将 MEGA独角兽 和 MG沙扎比 的中标改为赛罗，共 ', calc.item_count, ' 个商品'),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.supplierId = @sailuo_id
  AND a.status = 'ACTIVE';

-- 4. 更新其他供应商的 Award finalPrice（移除 MEGA独角兽 和 MG沙扎比）
SELECT '=== 更新其他供应商的 Award finalPrice ===' AS section;

-- 更新豪的 Award（移除 MEGA独角兽 和 MG沙扎比）
UPDATE awards a
INNER JOIN (
    SELECT 
        a2.id AS award_id,
        SUM(qi.price * COALESCE(ri.quantity, 1)) AS total_price,
        COUNT(DISTINCT qi.rfqItemId) AS item_count
    FROM awards a2
    INNER JOIN quotes q ON a2.quoteId = q.id
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE a2.rfqId = @rfq_id
      AND a2.status = 'ACTIVE'
      AND a2.supplierId != @sailuo_id
      AND ri.item_status = 'AWARDED'
      AND qi.rfqItemId NOT IN ('cmipi6gwf000dkq9fnqnu6bp5', 'cmipi6gwf000jkq9f9vxch2p0')
    GROUP BY a2.id
) AS calc ON a.id = calc.award_id
SET a.finalPrice = calc.total_price,
    a.reason = CONCAT('系统自动评标：按商品维度选择最低报价，共 ', calc.item_count, ' 个商品中标'),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status = 'ACTIVE'
  AND a.supplierId != @sailuo_id;

-- 更新胡先生的 Award（移除 MG沙扎比）
UPDATE awards a
INNER JOIN (
    SELECT 
        a2.id AS award_id,
        SUM(qi.price * COALESCE(ri.quantity, 1)) AS total_price,
        COUNT(DISTINCT qi.rfqItemId) AS item_count
    FROM awards a2
    INNER JOIN quotes q ON a2.quoteId = q.id
    INNER JOIN quote_items qi ON q.id = qi.quoteId
    INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
    WHERE a2.rfqId = @rfq_id
      AND a2.status = 'ACTIVE'
      AND a2.supplierId = (SELECT id FROM users WHERE username = '胡先生' COLLATE utf8mb4_unicode_ci)
      AND ri.item_status = 'AWARDED'
      AND qi.rfqItemId NOT IN ('cmipi6gwf000dkq9fnqnu6bp5', 'cmipi6gwf000jkq9f9vxch2p0')
    GROUP BY a2.id
) AS calc ON a.id = calc.award_id
SET a.finalPrice = calc.total_price,
    a.reason = CONCAT('系统自动评标：按商品维度选择最低报价，共 ', calc.item_count, ' 个商品中标'),
    a.updatedAt = NOW()
WHERE a.rfqId = @rfq_id
  AND a.status = 'ACTIVE'
  AND a.supplierId = (SELECT id FROM users WHERE username = '胡先生' COLLATE utf8mb4_unicode_ci);

-- 验证修复结果
SELECT '=== 修复后的 Award 记录 ===' AS section;

SELECT 
    a.id AS award_id,
    u.username AS supplier_name,
    a.status AS award_status,
    a.finalPrice,
    a.reason,
    COUNT(DISTINCT qi.rfqItemId) AS item_count,
    GROUP_CONCAT(DISTINCT ri.productName ORDER BY ri.productName SEPARATOR ', ') AS products
FROM awards a
INNER JOIN rfqs r ON a.rfqId = r.id
INNER JOIN users u ON a.supplierId = u.id
INNER JOIN quotes q ON a.quoteId = q.id
INNER JOIN quote_items qi ON q.id = qi.quoteId
INNER JOIN rfq_items ri ON qi.rfqItemId = ri.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND a.status = 'ACTIVE'
GROUP BY a.id, u.username, a.status, a.finalPrice, a.reason
ORDER BY u.username;

SELECT '=== 检查 MEGA独角兽 和 MG沙扎比 的中标情况 ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    u.username AS supplier_name,
    qi.price,
    a.id AS award_id,
    a.status AS award_status
FROM rfq_items ri
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN users u ON q.supplierId = u.id
LEFT JOIN awards a ON q.id = a.quoteId AND a.status = 'ACTIVE'
WHERE ri.id IN ('cmipi6gwf000dkq9fnqnu6bp5', 'cmipi6gwf000jkq9f9vxch2p0')
  AND ri.rfqId = @rfq_id
ORDER BY ri.productName, qi.price;

SELECT '=== 检查是否还有重复的 Award ===' AS section;

SELECT 
    ri.id AS rfq_item_id,
    ri.productName,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT u.username ORDER BY u.username SEPARATOR ', ') AS suppliers
FROM rfq_items ri
INNER JOIN rfqs r ON ri.rfqId = r.id
INNER JOIN quote_items qi ON ri.id = qi.rfqItemId
INNER JOIN quotes q ON qi.quoteId = q.id
INNER JOIN awards a ON q.id = a.quoteId
INNER JOIN users u ON a.supplierId = u.id
WHERE r.rfqNo = @rfq_no COLLATE utf8mb4_unicode_ci
  AND a.status = 'ACTIVE'
  AND qi.rfqItemId = ri.id
GROUP BY ri.id, ri.productName
HAVING active_award_count > 1;

COMMIT;

SELECT '=== 修复完成 ===' AS section;

