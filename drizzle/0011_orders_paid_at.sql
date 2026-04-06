-- Payment receipt time for honest "Collected today" and celebrations (not `updatedAt` noise).
ALTER TABLE `orders` ADD COLUMN `paidAt` timestamp NULL;

-- Best-effort backfill: historical paid rows use last update as proxy until real charges set `paidAt`.
UPDATE `orders` SET `paidAt` = `updatedAt` WHERE `paid` = 1 AND `paidAt` IS NULL;
