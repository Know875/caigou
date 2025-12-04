-- 修复缺失的 AwardItem 记录
-- 为两个没有 AwardItem 的 Award 创建记录

START TRANSACTION;

-- 1. 修复 cmipijrxg0047kq9f8ush5ecz (赛罗 - MEGA独角兽 和 MG沙扎比)
-- 查找该 Award 对应的 Quote 中包含的商品
INSERT INTO `award_items` (`id`, `awardId`, `rfqItemId`, `quoteItemId`, `price`, `quantity`, `createdAt`, `updatedAt`)
SELECT 
  CONCAT('ai_', SUBSTRING(MD5(CONCAT('cmipijrxg0047kq9f8ush5ecz', '_', qi.rfqItemId)), 1, 20)) AS `id`,
  'cmipijrxg0047kq9f8ush5ecz' AS `awardId`,
  qi.rfqItemId AS `rfqItemId`,
  qi.id AS `quoteItemId`,
  qi.price AS `price`,
  COALESCE(ri.quantity, 1) AS `quantity`,
  NOW() AS `createdAt`,
  NOW() AS `updatedAt`
FROM `awards` a
INNER JOIN `quotes` q ON a.quoteId = q.id
INNER JOIN `quote_items` qi ON q.id = qi.quoteId
INNER JOIN `rfq_items` ri ON qi.rfqItemId = ri.id
WHERE a.id = 'cmipijrxg0047kq9f8ush5ecz'
  AND ri.item_status = 'AWARDED'
  AND ri.rfqId = a.rfqId
  AND (ri.productName LIKE '%MEGA独角兽%' OR ri.productName LIKE '%MG沙扎比%')
ON DUPLICATE KEY UPDATE `updatedAt` = NOW();

-- 2. 修复 cmimujlja0041kqi62f3vqcy0 (赛罗 - 7个模玩兽100元福袋)
-- 查找该 Award 对应的 Quote 中包含的商品
INSERT INTO `award_items` (`id`, `awardId`, `rfqItemId`, `quoteItemId`, `price`, `quantity`, `createdAt`, `updatedAt`)
SELECT 
  CONCAT('ai_', SUBSTRING(MD5(CONCAT('cmimujlja0041kqi62f3vqcy0', '_', qi.rfqItemId)), 1, 20)) AS `id`,
  'cmimujlja0041kqi62f3vqcy0' AS `awardId`,
  qi.rfqItemId AS `rfqItemId`,
  qi.id AS `quoteItemId`,
  qi.price AS `price`,
  COALESCE(ri.quantity, 1) AS `quantity`,
  NOW() AS `createdAt`,
  NOW() AS `updatedAt`
FROM `awards` a
INNER JOIN `quotes` q ON a.quoteId = q.id
INNER JOIN `quote_items` qi ON q.id = qi.quoteId
INNER JOIN `rfq_items` ri ON qi.rfqItemId = ri.id
WHERE a.id = 'cmimujlja0041kqi62f3vqcy0'
  AND ri.item_status = 'AWARDED'
  AND ri.rfqId = a.rfqId
  AND ri.productName LIKE '%模玩兽100元福袋%'
ON DUPLICATE KEY UPDATE `updatedAt` = NOW();

-- 显示修复结果
SELECT 
  COUNT(*) AS `total_award_items_after_fix`,
  COUNT(DISTINCT `awardId`) AS `awards_with_items_after_fix`
FROM `award_items`;

-- 验证修复后的结果
SELECT 
  a.id as award_id,
  u.username as supplier_name,
  COUNT(ai.id) as item_count,
  SUM(ai.price * ai.quantity) as total_price,
  a.finalPrice as award_final_price
FROM awards a
LEFT JOIN award_items ai ON a.id = ai.awardId
LEFT JOIN users u ON a.supplierId = u.id
WHERE a.id IN ('cmipijrxg0047kq9f8ush5ecz', 'cmimujlja0041kqi62f3vqcy0')
GROUP BY a.id, u.username, a.finalPrice;

COMMIT;

