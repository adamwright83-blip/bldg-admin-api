-- Historical order-routing columns were introduced through schema push before
-- the repository adopted the numbered production migration discipline. Keep
-- this migration idempotent so existing Railway databases and fresh release
-- databases converge on the same persisted contract.

SET @dayforge_order_column_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'buildingSlug'
  ),
  'SELECT 1',
  'ALTER TABLE `orders` ADD COLUMN `buildingSlug` varchar(100) NULL'
);
PREPARE dayforge_order_column_stmt FROM @dayforge_order_column_sql;
EXECUTE dayforge_order_column_stmt;
DEALLOCATE PREPARE dayforge_order_column_stmt;
SET @dayforge_order_column_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'vendorId'
  ),
  'SELECT 1',
  'ALTER TABLE `orders` ADD COLUMN `vendorId` int NULL'
);
PREPARE dayforge_order_column_stmt FROM @dayforge_order_column_sql;
EXECUTE dayforge_order_column_stmt;
DEALLOCATE PREPARE dayforge_order_column_stmt;

SET @dayforge_order_column_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'vendorNameSnapshot'
  ),
  'SELECT 1',
  'ALTER TABLE `orders` ADD COLUMN `vendorNameSnapshot` varchar(255) NULL'
);
PREPARE dayforge_order_column_stmt FROM @dayforge_order_column_sql;
EXECUTE dayforge_order_column_stmt;
DEALLOCATE PREPARE dayforge_order_column_stmt;

SET @dayforge_order_column_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'routingPrioritySnapshot'
  ),
  'SELECT 1',
  'ALTER TABLE `orders` ADD COLUMN `routingPrioritySnapshot` int NULL'
);
PREPARE dayforge_order_column_stmt FROM @dayforge_order_column_sql;
EXECUTE dayforge_order_column_stmt;
DEALLOCATE PREPARE dayforge_order_column_stmt;

SET @dayforge_order_column_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'platformFeeCents'
  ),
  'SELECT 1',
  'ALTER TABLE `orders` ADD COLUMN `platformFeeCents` int NULL'
);
PREPARE dayforge_order_column_stmt FROM @dayforge_order_column_sql;
EXECUTE dayforge_order_column_stmt;
DEALLOCATE PREPARE dayforge_order_column_stmt;

SET @dayforge_order_column_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'vendorPayoutCents'
  ),
  'SELECT 1',
  'ALTER TABLE `orders` ADD COLUMN `vendorPayoutCents` int NULL'
);
PREPARE dayforge_order_column_stmt FROM @dayforge_order_column_sql;
EXECUTE dayforge_order_column_stmt;
DEALLOCATE PREPARE dayforge_order_column_stmt;

SET @dayforge_order_column_sql = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'orders'
      AND COLUMN_NAME = 'stripeConnectedAccountIdSnapshot'
  ),
  'SELECT 1',
  'ALTER TABLE `orders` ADD COLUMN `stripeConnectedAccountIdSnapshot` varchar(255) NULL'
);
PREPARE dayforge_order_column_stmt FROM @dayforge_order_column_sql;
EXECUTE dayforge_order_column_stmt;
DEALLOCATE PREPARE dayforge_order_column_stmt;
