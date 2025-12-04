-- 创建 award_items 表
CREATE TABLE IF NOT EXISTS `award_items` (
  `id` VARCHAR(191) NOT NULL,
  `awardId` VARCHAR(191) NOT NULL,
  `rfqItemId` VARCHAR(191) NOT NULL,
  `quoteItemId` VARCHAR(191) NOT NULL,
  `price` DECIMAL(10, 2) NOT NULL,
  `quantity` INT NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `award_items_awardId_rfqItemId_key` (`awardId`, `rfqItemId`),
  KEY `award_items_awardId_idx` (`awardId`),
  KEY `award_items_rfqItemId_idx` (`rfqItemId`),
  KEY `award_items_quoteItemId_idx` (`quoteItemId`),
  CONSTRAINT `award_items_awardId_fkey` FOREIGN KEY (`awardId`) REFERENCES `awards` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `award_items_rfqItemId_fkey` FOREIGN KEY (`rfqItemId`) REFERENCES `rfq_items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `award_items_quoteItemId_fkey` FOREIGN KEY (`quoteItemId`) REFERENCES `quote_items` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

