-- LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.
-- 0143: Reassign CleanCloud data, goal lineage, and recovery contacts to Laundry Farm
-- Preserves Laundry Butler as tenant `default` and keeps all Stripe native orders in `default`.
-- Idempotent and safe for rerun.

CREATE TABLE IF NOT EXISTS `cleancloud_browser_sync_bindings` (
  `tenantId` VARCHAR(64) PRIMARY KEY,
  `id` VARCHAR(36) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `storeLabel` VARCHAR(255) NOT NULL,
  `createdBy` VARCHAR(128) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `lastSuccessAt` TIMESTAMP NULL
);

CREATE TABLE IF NOT EXISTS `cleancloud_browser_sync_receipts` (
  `id` VARCHAR(36) PRIMARY KEY,
  `tenantId` VARCHAR(64) NOT NULL,
  `requestId` VARCHAR(36) NOT NULL,
  `digest` VARCHAR(64) NOT NULL,
  `storeId` VARCHAR(32) NOT NULL,
  `importBatchId` INT NOT NULL,
  `receiptJson` JSON NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY `uq_cc_browser_sync_request` (`tenantId`, `requestId`)
);

CREATE TABLE IF NOT EXISTS `cleancloud_browser_sync_attempts` (
  `id` VARCHAR(36) PRIMARY KEY,
  `tenantId` VARCHAR(64) NOT NULL,
  `requestId` VARCHAR(36) NULL,
  `outcome` VARCHAR(32) NOT NULL,
  `message` VARCHAR(512) NULL,
  `rangeFrom` VARCHAR(10) NULL,
  `rangeTo` VARCHAR(10) NULL,
  `rowCount` INT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_cc_browser_sync_attempts_tenant` (`tenantId`, `createdAt`)
);

-- 1. CleanCloud browser sync bindings for Store #34145
-- Move binding to `laundry_farm`. If `laundry_farm` binding already exists, keep it.
INSERT INTO `cleancloud_browser_sync_bindings` (`tenantId`, `id`, `storeId`, `storeLabel`, `createdBy`, `createdAt`, `lastSuccessAt`)
SELECT 'laundry_farm', `id`, `storeId`, `storeLabel`, `createdBy`, `createdAt`, `lastSuccessAt`
FROM `cleancloud_browser_sync_bindings`
WHERE `storeId` = '34145' AND `tenantId` = 'default'
ON DUPLICATE KEY UPDATE `storeLabel` = VALUES(`storeLabel`), `lastSuccessAt` = VALUES(`lastSuccessAt`);

DELETE FROM `cleancloud_browser_sync_bindings`
WHERE `storeId` = '34145' AND `tenantId` = 'default';

-- Receipts and sync attempts for Store #34145
UPDATE `cleancloud_browser_sync_receipts`
SET `tenantId` = 'laundry_farm'
WHERE `storeId` = '34145' AND `tenantId` = 'default';

UPDATE `cleancloud_browser_sync_attempts`
SET `tenantId` = 'laundry_farm'
WHERE `tenantId` = 'default';

-- 2. CleanCloud paid orders: all 1,095 rows belong to CleanCloud Store #34145
UPDATE `cleancloud_paid_orders`
SET `tenantId` = 'laundry_farm'
WHERE `tenantId` = 'default';

-- 3. Historical CleanCloud cadence orders in `orders`
-- Identified by residentClientRequestId with 'goldline:cadence:%'.
-- Preserves native Stripe orders (Order #707, etc.) firmly in `default`.
UPDATE `orders`
SET `tenantId` = 'laundry_farm'
WHERE `residentClientRequestId` LIKE 'goldline:cadence:%'
  AND `tenantId` = 'default';

-- 4. Attribute 50-active-customer goal lineage to Laundry Farm
-- Update macro goal runs
UPDATE `macro_goal_runs`
SET `tenantId` = 'laundry_farm'
WHERE `id` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update operator macro goals
UPDATE `operator_macro_goals`
SET `tenantId` = 'laundry_farm'
WHERE (`metricKey` = 'active_customers_50' OR `id` IN (
  SELECT `macroGoalId` FROM `macro_goal_runs` WHERE `id` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff'
)) AND `tenantId` = 'default';

-- Update goal cycle requests
UPDATE `goal_cycle_requests`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update goal cycle decisions
UPDATE `goal_cycle_decisions`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update goal cycle objectives
UPDATE `goal_cycle_objectives`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update goal cycle outcomes
UPDATE `goal_cycle_outcomes`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update goal cycle learned deltas
UPDATE `goal_cycle_learned_deltas`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update goal cycle history
UPDATE `goal_cycle_history`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update goal cycle dead letters
UPDATE `goal_cycle_dead_letters`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff' AND `tenantId` = 'default';

-- Update work threads associated with this goal (authoritative: firstSourceRef or opportunityKey)
UPDATE `work_threads`
SET `tenantId` = 'laundry_farm'
WHERE (`firstSourceRef` LIKE '%9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff%'
       OR `opportunityKey` LIKE 'cleancloud:%')
  AND `tenantId` = 'default';

-- 5. Invalidate incorrectly branded drafts and reassign 16 CleanCloud recovery obligations
-- Reassigns to laundry_farm, sets status = 'scheduled', and clears draft = null
UPDATE `claire_proactive_obligations`
SET `tenantId` = 'laundry_farm',
    `status` = 'scheduled',
    `payloadJson` = JSON_SET(`payloadJson`, '$.draft', NULL)
WHERE `tenantId` = 'default'
  AND (`goalRunId` = '9e7dd9ae-ad31-4127-b5cc-44a69c0dcbff'
       OR `subjectKey` LIKE 'cleancloud:%');

-- 6. Commercial accounts replication: replicate all commercial properties from `default`
-- into `laundry_farm` with identical identityKey, preserving existing records in `default`.
-- Preserves accounts #15 and #17 as distinct records.
INSERT INTO `commercial_accounts` (
  `tenantId`, `identityKey`, `name`, `accountType`, `providerName`, `providerAccountId`, `website`
)
SELECT
  'laundry_farm',
  `identityKey`,
  `name`,
  `accountType`,
  `providerName`,
  `providerAccountId`,
  `website`
FROM `commercial_accounts`
WHERE `tenantId` = 'default' AND `identityKey` IS NOT NULL
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);

-- Replicate commercial account locations
INSERT INTO `commercial_account_locations` (
  `tenantId`, `accountId`, `locationKey`, `label`, `address`, `latitude`, `longitude`, `isPrimary`
)
SELECT
  'laundry_farm',
  ca_farm.id,
  cal.locationKey,
  cal.label,
  cal.address,
  cal.latitude,
  cal.longitude,
  cal.isPrimary
FROM `commercial_account_locations` cal
JOIN `commercial_accounts` ca_default ON cal.accountId = ca_default.id AND cal.tenantId = 'default'
JOIN `commercial_accounts` ca_farm ON ca_farm.tenantId = 'laundry_farm'
  AND ca_farm.identityKey = ca_default.identityKey
WHERE ca_default.tenantId = 'default'
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

