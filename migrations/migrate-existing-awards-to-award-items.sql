-- 从现有 Award 记录生成 AwardItem 记录
-- 这个脚本会分析每个 ACTIVE 的 Award，找到其对应的 Quote 中包含的所有商品，
-- 然后根据 RfqItem 的状态和价格匹配，确定哪些商品真正中标了

START TRANSACTION;

-- 临时表：存储需要创建的 AwardItem 记录
CREATE TEMPORARY TABLE IF NOT EXISTS `temp_award_items` (
  `id` VARCHAR(191) NOT NULL,
  `awardId` VARCHAR(191) NOT NULL,
  `rfqItemId` VARCHAR(191) NOT NULL,
  `quoteItemId` VARCHAR(191) NOT NULL,
  `price` DECIMAL(10, 2) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
);

-- 插入 AwardItem 记录
-- 逻辑：对于每个 ACTIVE 的 Award，找到其对应的 Quote 中的所有 quote_items
-- 然后检查对应的 RfqItem 是否状态为 AWARDED，如果是，则创建 AwardItem 记录
INSERT INTO `temp_award_items` (`id`, `awardId`, `rfqItemId`, `quoteItemId`, `price`, `quantity`)
SELECT 
  CONCAT('ai_', SUBSTRING(MD5(CONCAT(a.id, '_', qi.rfqItemId)), 1, 20)) AS `id`,
  a.id AS `awardId`,
  qi.rfqItemId AS `rfqItemId`,
  qi.id AS `quoteItemId`,
  qi.price AS `price`,
  COALESCE(ri.quantity, 1) AS `quantity`
FROM `awards` a
INNER JOIN `quotes` q ON a.quoteId = q.id
INNER JOIN `quote_items` qi ON q.id = qi.quoteId
INNER JOIN `rfq_items` ri ON qi.rfqItemId = ri.id
WHERE a.status = 'ACTIVE'
  AND ri.item_status = 'AWARDED'
  AND ri.rfqId = a.rfqId
  -- 确保该商品确实由该供应商中标（通过价格匹配）
  -- 如果该商品有多个报价，选择价格最低的（符合业务逻辑）
  AND qi.price = (
    SELECT MIN(qi2.price)
    FROM `quote_items` qi2
    INNER JOIN `quotes` q2 ON qi2.quoteId = q2.id
    WHERE qi2.rfqItemId = qi.rfqItemId
      AND q2.supplierId = q.supplierId
      AND q2.status = 'AWARDED'
  )
ON DUPLICATE KEY UPDATE `id` = `id`; -- 如果已存在，跳过

-- 插入到 award_items 表
INSERT INTO `award_items` (`id`, `awardId`, `rfqItemId`, `quoteItemId`, `price`, `quantity`, `createdAt`, `updatedAt`)
SELECT 
  `id`,
  `awardId`,
  `rfqItemId`,
  `quoteItemId`,
  `price`,
  `quantity`,
  NOW() AS `createdAt`,
  NOW() AS `updatedAt`
FROM `temp_award_items`
ON DUPLICATE KEY UPDATE `updatedAt` = NOW();

-- 清理临时表
DROP TEMPORARY TABLE IF EXISTS `temp_award_items`;

-- 显示统计信息
SELECT 
  COUNT(*) AS `total_award_items_created`,
  COUNT(DISTINCT `awardId`) AS `awards_affected`
FROM `award_items`;

COMMIT;

