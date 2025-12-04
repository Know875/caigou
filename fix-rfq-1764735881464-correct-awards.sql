-- 修复 RFQ-1764735881464：取消错误的 Award，为每个商品创建正确的 Award
-- 注意：执行前请先运行 check-rfq-1764735881464.sql 和 fix-rfq-1764735881464-reevaluate.sql 查看数据

SET @rfq_no = 'RFQ-1764735881464';
SET @rfq_id = (SELECT id FROM rfqs WHERE BINARY rfqNo = BINARY @rfq_no LIMIT 1);

-- 设置变量
SELECT '=== 变量设置 ===' AS section;
SELECT 
    @rfq_id AS rfq_id;

-- ============================================
-- 开始修复
-- ============================================

SET autocommit = 0;
START TRANSACTION;

-- 1. 取消所有现有的 ACTIVE Award（因为需要重新评标）
UPDATE awards
SET status = 'CANCELLED',
    cancellation_reason = 'MANUAL_REAWARD',
    cancelled_at = NOW(),
    updatedAt = NOW()
WHERE rfqId = @rfq_id
  AND status = 'ACTIVE';

SELECT CONCAT('已取消 ', ROW_COUNT(), ' 个 ACTIVE Award') AS message;

-- 2. 为每个 AWARDED 商品找到正确的供应商（最低价，价格相同时最早提交）
-- 并创建新的 Award 记录

-- 2.1 MEGA独角兽：三个供应商都是 490.00，选择最早提交的
SET @mega_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'MEGA独角兽' LIMIT 1);
SET @mega_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    WHERE qi.rfqItemId = @mega_item_id
      AND qi.price = 490.00
    ORDER BY q.submittedAt ASC
    LIMIT 1
);
SET @mega_quote_id = (SELECT quoteId FROM quote_items WHERE id = @mega_quote_item_id LIMIT 1);
SET @mega_supplier_id = (SELECT supplierId FROM quotes WHERE id = @mega_quote_id LIMIT 1);

-- 2.2 MGSD巴巴托斯：豪 205.00（最低）
SET @mgsd_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'MGSD巴巴托斯' LIMIT 1);
SET @mgsd_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @mgsd_item_id
      AND u.username = '豪'
      AND qi.price = 205.00
    LIMIT 1
);
SET @mgsd_quote_id = (SELECT quoteId FROM quote_items WHERE id = @mgsd_quote_item_id LIMIT 1);
SET @mgsd_supplier_id = (SELECT supplierId FROM quotes WHERE id = @mgsd_quote_id LIMIT 1);

-- 2.3 MG卡掉毛：豪 308.00（唯一报价）
SET @mg_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'MG卡掉毛' LIMIT 1);
SET @mg_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @mg_item_id
      AND u.username = '豪'
      AND qi.price = 308.00
    LIMIT 1
);
SET @mg_quote_id = (SELECT quoteId FROM quote_items WHERE id = @mg_quote_item_id LIMIT 1);
SET @mg_supplier_id = (SELECT supplierId FROM quotes WHERE id = @mg_quote_id LIMIT 1);

-- 2.4 MG沙扎比：豪和赛罗都是 470.00，选择最早提交的
SET @mgz_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'MG沙扎比' LIMIT 1);
SET @mgz_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    WHERE qi.rfqItemId = @mgz_item_id
      AND qi.price = 470.00
    ORDER BY q.submittedAt ASC
    LIMIT 1
);
SET @mgz_quote_id = (SELECT quoteId FROM quote_items WHERE id = @mgz_quote_item_id LIMIT 1);
SET @mgz_supplier_id = (SELECT supplierId FROM quotes WHERE id = @mgz_quote_id LIMIT 1);

-- 2.5 MG重炮手：菜狗 160.00（最低）
SET @mgc_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'MG重炮手' LIMIT 1);
SET @mgc_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @mgc_item_id
      AND u.username = '菜狗'
      AND qi.price = 160.00
    LIMIT 1
);
SET @mgc_quote_id = (SELECT quoteId FROM quote_items WHERE id = @mgc_quote_item_id LIMIT 1);
SET @mgc_supplier_id = (SELECT supplierId FROM quotes WHERE id = @mgc_quote_id LIMIT 1);

-- 2.6 MR魂不朽正义：菜狗 785.00（唯一报价）
SET @mr_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'MR魂不朽正义' LIMIT 1);
SET @mr_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @mr_item_id
      AND u.username = '菜狗'
      AND qi.price = 785.00
    LIMIT 1
);
SET @mr_quote_id = (SELECT quoteId FROM quote_items WHERE id = @mr_quote_item_id LIMIT 1);
SET @mr_supplier_id = (SELECT supplierId FROM quotes WHERE id = @mr_quote_id LIMIT 1);

-- 2.7 SHF驰骑（第一个）：赛罗 615.00（唯一报价）
SET @shf1_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'SHF驰骑' ORDER BY createdAt LIMIT 1);
SET @shf1_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @shf1_item_id
      AND u.username = '赛罗'
      AND qi.price = 615.00
    LIMIT 1
);
SET @shf1_quote_id = (SELECT quoteId FROM quote_items WHERE id = @shf1_quote_item_id LIMIT 1);
SET @shf1_supplier_id = (SELECT supplierId FROM quotes WHERE id = @shf1_quote_id LIMIT 1);

-- 2.8 SHF驰骑（第二个）：赛罗 615.00（唯一报价）
SET @shf2_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'SHF驰骑' ORDER BY createdAt DESC LIMIT 1);
SET @shf2_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @shf2_item_id
      AND u.username = '赛罗'
      AND qi.price = 615.00
    LIMIT 1
);
SET @shf2_quote_id = (SELECT quoteId FROM quote_items WHERE id = @shf2_quote_item_id LIMIT 1);
SET @shf2_supplier_id = (SELECT supplierId FROM quotes WHERE id = @shf2_quote_id LIMIT 1);

-- 2.9 阿克西斯大青椒：豪 510.00（最低）
SET @ak_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = '阿克西斯大青椒' LIMIT 1);
SET @ak_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @ak_item_id
      AND u.username = '豪'
      AND qi.price = 510.00
    LIMIT 1
);
SET @ak_quote_id = (SELECT quoteId FROM quote_items WHERE id = @ak_quote_item_id LIMIT 1);
SET @ak_supplier_id = (SELECT supplierId FROM quotes WHERE id = @ak_quote_id LIMIT 1);

-- 2.10 RG福冈牛：胡先生 330.00（已有 ACTIVE Award，保持不变）
SET @rg_item_id = (SELECT id FROM rfq_items WHERE rfqId = @rfq_id AND productName = 'RG福冈牛' LIMIT 1);
SET @rg_quote_item_id = (
    SELECT qi.id
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    INNER JOIN users u ON q.supplierId = u.id
    WHERE qi.rfqItemId = @rg_item_id
      AND u.username = '胡先生'
      AND qi.price = 330.00
    LIMIT 1
);
SET @rg_quote_id = (SELECT quoteId FROM quote_items WHERE id = @rg_quote_item_id LIMIT 1);
SET @rg_supplier_id = (SELECT supplierId FROM quotes WHERE id = @rg_quote_id LIMIT 1);

-- 3. 按供应商分组，创建 Award 记录
-- 3.1 豪的 Award（包含：MEGA独角兽、MGSD巴巴托斯、MG卡掉毛、MG沙扎比、阿克西斯大青椒）
SET @hao_quote_id = (SELECT id FROM quotes WHERE rfqId = @rfq_id AND supplierId = @mega_supplier_id LIMIT 1);
SET @hao_final_price = 490.00 + 205.00 + 308.00 + 470.00 + 510.00; -- 1983.00

-- 检查豪是否已有 Award
SET @hao_award_id = (
    SELECT id FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @mega_supplier_id 
      AND status != 'CANCELLED'
    LIMIT 1
);

-- 如果豪没有 Award，创建新的
INSERT INTO awards (
    id,
    rfqId,
    quoteId,
    supplierId,
    finalPrice,
    reason,
    status,
    awardedAt,
    createdAt,
    updatedAt
)
SELECT 
    CONCAT('cmi', SUBSTRING(MD5(CONCAT(@rfq_id, @mega_supplier_id, NOW())), 1, 25)),
    @rfq_id,
    @hao_quote_id,
    @mega_supplier_id,
    @hao_final_price,
    '手动修复：重新评标，选择最低报价',
    'ACTIVE',
    NOW(),
    NOW(),
    NOW()
WHERE @hao_award_id IS NULL
  AND @hao_quote_id IS NOT NULL
  AND @hao_final_price > 0
  AND NOT EXISTS (
      SELECT 1 FROM awards a 
      WHERE a.rfqId = @rfq_id 
        AND a.supplierId = @mega_supplier_id 
        AND a.status != 'CANCELLED'
  );

-- 如果豪已有 Award，更新它
UPDATE awards
SET finalPrice = @hao_final_price,
    reason = '手动修复：重新评标，选择最低报价',
    updatedAt = NOW()
WHERE id = @hao_award_id
  AND @hao_award_id IS NOT NULL;

SELECT 
    CASE 
        WHEN @hao_award_id IS NOT NULL THEN CONCAT('已更新豪的 Award，价格: ', @hao_final_price)
        WHEN @hao_quote_id IS NOT NULL THEN CONCAT('已为豪创建 Award，价格: ', @hao_final_price)
        ELSE '豪的 Award 操作失败'
    END AS message;

-- 3.2 菜狗的 Award（包含：MG重炮手、MR魂不朽正义）
SET @caigou_quote_id = (SELECT id FROM quotes WHERE rfqId = @rfq_id AND supplierId = @mgc_supplier_id LIMIT 1);
SET @caigou_final_price = 160.00 + 785.00; -- 945.00

SET @caigou_award_id = (
    SELECT id FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @mgc_supplier_id 
      AND status != 'CANCELLED'
    LIMIT 1
);

-- 如果菜狗没有 Award，创建新的
INSERT INTO awards (
    id,
    rfqId,
    quoteId,
    supplierId,
    finalPrice,
    reason,
    status,
    awardedAt,
    createdAt,
    updatedAt
)
SELECT 
    CONCAT('cmi', SUBSTRING(MD5(CONCAT(@rfq_id, @mgc_supplier_id, NOW())), 1, 25)),
    @rfq_id,
    @caigou_quote_id,
    @mgc_supplier_id,
    @caigou_final_price,
    '手动修复：重新评标，选择最低报价',
    'ACTIVE',
    NOW(),
    NOW(),
    NOW()
WHERE @caigou_award_id IS NULL
  AND @caigou_quote_id IS NOT NULL
  AND @caigou_final_price > 0
  AND NOT EXISTS (
      SELECT 1 FROM awards a 
      WHERE a.rfqId = @rfq_id 
        AND a.supplierId = @mgc_supplier_id 
        AND a.status != 'CANCELLED'
  );

-- 如果菜狗已有 Award，更新它
UPDATE awards
SET finalPrice = @caigou_final_price,
    reason = '手动修复：重新评标，选择最低报价',
    updatedAt = NOW()
WHERE id = @caigou_award_id
  AND @caigou_award_id IS NOT NULL;

SELECT 
    CASE 
        WHEN @caigou_award_id IS NOT NULL THEN CONCAT('已更新菜狗的 Award，价格: ', @caigou_final_price)
        WHEN @caigou_quote_id IS NOT NULL THEN CONCAT('已为菜狗创建 Award，价格: ', @caigou_final_price)
        ELSE '菜狗的 Award 操作失败'
    END AS message;

-- 3.3 赛罗的 Award（包含：SHF驰骑 x2）
SET @sailuo_quote_id = (SELECT id FROM quotes WHERE rfqId = @rfq_id AND supplierId = @shf1_supplier_id LIMIT 1);
SET @sailuo_final_price = 615.00 + 615.00; -- 1230.00

SET @sailuo_award_id = (
    SELECT id FROM awards 
    WHERE rfqId = @rfq_id 
      AND supplierId = @shf1_supplier_id 
      AND status != 'CANCELLED'
    LIMIT 1
);

-- 如果赛罗没有 Award，创建新的
INSERT INTO awards (
    id,
    rfqId,
    quoteId,
    supplierId,
    finalPrice,
    reason,
    status,
    awardedAt,
    createdAt,
    updatedAt
)
SELECT 
    CONCAT('cmi', SUBSTRING(MD5(CONCAT(@rfq_id, @shf1_supplier_id, NOW())), 1, 25)),
    @rfq_id,
    @sailuo_quote_id,
    @shf1_supplier_id,
    @sailuo_final_price,
    '手动修复：重新评标，选择最低报价',
    'ACTIVE',
    NOW(),
    NOW(),
    NOW()
WHERE @sailuo_award_id IS NULL
  AND @sailuo_quote_id IS NOT NULL
  AND @sailuo_final_price > 0
  AND NOT EXISTS (
      SELECT 1 FROM awards a 
      WHERE a.rfqId = @rfq_id 
        AND a.supplierId = @shf1_supplier_id 
        AND a.status != 'CANCELLED'
  );

-- 如果赛罗已有 Award，更新它
UPDATE awards
SET finalPrice = @sailuo_final_price,
    reason = '手动修复：重新评标，选择最低报价',
    updatedAt = NOW()
WHERE id = @sailuo_award_id
  AND @sailuo_award_id IS NOT NULL;

SELECT 
    CASE 
        WHEN @sailuo_award_id IS NOT NULL THEN CONCAT('已更新赛罗的 Award，价格: ', @sailuo_final_price)
        WHEN @sailuo_quote_id IS NOT NULL THEN CONCAT('已为赛罗创建 Award，价格: ', @sailuo_final_price)
        ELSE '赛罗的 Award 操作失败'
    END AS message;

-- 3.4 胡先生的 Award（包含：RG福冈牛，已有，保持不变）
-- 不需要操作，因为胡先生的 Award 已经是正确的

-- 提交事务
COMMIT;

SELECT '=== 修复完成 ===' AS section;
SELECT '事务已自动提交。请运行验证脚本确认结果。' AS notice;

