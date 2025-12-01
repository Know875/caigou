-- 修复福袋商品错误中标问题
-- RFQ-1764574989800
-- 问题：福袋商品一口价¥86.00，"可乐"和"赛罗"报价¥86.00应该中标，但"豪"（¥89.00）被错误选中

-- 1. 查找该询价单的ID
-- SELECT id, rfqNo FROM rfqs WHERE rfqNo = 'RFQ-1764574989800';

-- 2. 查找福袋商品的rfqItemId（需要替换为实际的rfqId）
-- SELECT id, productName, instantPrice, maxPrice, itemStatus 
-- FROM rfq_items 
-- WHERE rfqId = 'RFQ_ID' AND productName LIKE '%模玩兽100元福袋%';

-- 3. 查找"豪"对该商品的报价（需要替换为实际的rfqItemId和supplierId）
-- SELECT qi.id, qi.quoteId, qi.rfqItemId, qi.price, q.supplierId, u.username
-- FROM quote_items qi
-- INNER JOIN quotes q ON qi.quoteId = q.id
-- INNER JOIN users u ON q.supplierId = u.id
-- WHERE qi.rfqItemId = 'RFQ_ITEM_ID' AND u.username = '豪';

-- 4. 查找"可乐"和"赛罗"对该商品的报价（需要替换为实际的rfqItemId）
-- SELECT qi.id, qi.quoteId, qi.rfqItemId, qi.price, q.supplierId, u.username
-- FROM quote_items qi
-- INNER JOIN quotes q ON qi.quoteId = q.id
-- INNER JOIN users u ON q.supplierId = u.id
-- WHERE qi.rfqItemId = 'RFQ_ITEM_ID' AND u.username IN ('可乐', '赛罗')
-- ORDER BY qi.price ASC;

-- 5. 修复步骤（需要替换为实际的值）：
--    a. 将"豪"中标的福袋商品的itemStatus重置为PENDING
--    b. 删除"豪"的Award记录（如果只包含福袋商品）
--    c. 将"可乐"或"赛罗"的报价设置为中标（选择最低价，如果价格相同则选择第一个）

-- 示例SQL（需要根据实际情况修改）：
/*
-- 假设：
-- rfqId = 'cmilbnu4n005akqz7ck2rvlmz'
-- 福袋商品的rfqItemId = 'cmilbnu6j005fkqz74c187ktx'
-- "豪"的supplierId = 'cmigt6kli0004kq0j3kybz0wp'
-- "可乐"的supplierId = 'cmigt6kli0003kq0j3kybz0wo'
-- "赛罗"的supplierId = 'cmigt6kli0005kq0j3kybz0wq'

-- 开始事务
START TRANSACTION;

-- 1. 重置福袋商品的状态（只重置"豪"中标的，不重置已通过一口价自动中标的）
UPDATE rfq_items 
SET itemStatus = 'PENDING'
WHERE rfqId = 'cmilbnu4n005akqz7ck2rvlmz' 
  AND productName LIKE '%模玩兽100元福袋%'
  AND itemStatus = 'AWARDED'
  AND id IN (
    -- 查找"豪"中标的福袋商品
    SELECT qi.rfqItemId
    FROM quote_items qi
    INNER JOIN quotes q ON qi.quoteId = q.id
    WHERE q.supplierId = 'cmigt6kli0004kq0j3kybz0wp'
      AND qi.rfqItemId IN (
        SELECT id FROM rfq_items 
        WHERE rfqId = 'cmilbnu4n005akqz7ck2rvlmz' 
          AND productName LIKE '%模玩兽100元福袋%'
      )
  );

-- 2. 查找"可乐"和"赛罗"的报价，选择最低价（¥86.00）
-- 假设"可乐"的报价ID是 quoteItemId_kele
-- 假设"赛罗"的报价ID是 quoteItemId_sailuo

-- 3. 将"可乐"的报价设置为中标（如果价格相同，选择第一个）
UPDATE rfq_items 
SET itemStatus = 'AWARDED'
WHERE id IN (
  SELECT qi.rfqItemId
  FROM quote_items qi
  INNER JOIN quotes q ON qi.quoteId = q.id
  INNER JOIN users u ON q.supplierId = u.id
  WHERE qi.rfqItemId IN (
    SELECT id FROM rfq_items 
    WHERE rfqId = 'cmilbnu4n005akqz7ck2rvlmz' 
      AND productName LIKE '%模玩兽100元福袋%'
  )
  AND u.username = '可乐'
  AND qi.price = 86.00
  LIMIT 1
);

-- 4. 更新"可乐"的报价状态为AWARDED
UPDATE quotes
SET status = 'AWARDED'
WHERE id IN (
  SELECT DISTINCT q.id
  FROM quotes q
  INNER JOIN quote_items qi ON q.id = qi.quoteId
  INNER JOIN users u ON q.supplierId = u.id
  WHERE qi.rfqItemId IN (
    SELECT id FROM rfq_items 
    WHERE rfqId = 'cmilbnu4n005akqz7ck2rvlmz' 
      AND productName LIKE '%模玩兽100元福袋%'
      AND itemStatus = 'AWARDED'
  )
  AND u.username = '可乐'
);

-- 5. 更新"豪"的报价状态为REJECTED（如果该报价没有其他商品中标）
UPDATE quotes
SET status = 'REJECTED'
WHERE id IN (
  SELECT DISTINCT q.id
  FROM quotes q
  INNER JOIN quote_items qi ON q.id = qi.quoteId
  INNER JOIN users u ON q.supplierId = u.id
  WHERE qi.rfqItemId IN (
    SELECT id FROM rfq_items 
    WHERE rfqId = 'cmilbnu4n005akqz7ck2rvlmz' 
      AND productName LIKE '%模玩兽100元福袋%'
      AND itemStatus = 'PENDING'
  )
  AND u.username = '豪'
  AND q.id NOT IN (
    -- 如果该报价有其他商品中标，不更新状态
    SELECT DISTINCT q2.id
    FROM quotes q2
    INNER JOIN quote_items qi2 ON q2.id = qi2.quoteId
    INNER JOIN rfq_items ri2 ON qi2.rfqItemId = ri2.id
    WHERE ri2.itemStatus = 'AWARDED'
      AND q2.supplierId = 'cmigt6kli0004kq0j3kybz0wp'
  )
);

-- 6. 删除或更新"豪"的Award记录（如果只包含福袋商品）
-- 需要先检查Award记录包含哪些商品
-- 如果Award记录还包含其他商品（如SHF巧爷），则只更新finalPrice，不删除

-- 提交事务
COMMIT;
*/

-- 注意：以上SQL需要根据实际情况修改，建议先执行查询语句确认数据，再执行更新语句

