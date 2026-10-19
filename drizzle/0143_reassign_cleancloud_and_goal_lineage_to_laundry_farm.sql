-- 0143: Reassign CleanCloud data, goal lineage, and recovery contacts to Laundry Farm
-- Preserves Laundry Butler as tenant `default` and keeps all Stripe native orders in `default`.
-- Idempotent and safe for rerun.

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
-- Resolve goal run ID
SET @goal_run_id = (
  SELECT `id` FROM `macro_goal_runs`
  WHERE (`id` LIKE '9e7dd9ae%' OR `metricKey` = 'active_customers_50' OR `goalSnapshotJson` LIKE '%50%')
    AND `tenantId` IN ('default', 'laundry_farm')
  ORDER BY `createdAt` DESC LIMIT 1
);

SET @macro_goal_id = (
  SELECT `macroGoalId` FROM `macro_goal_runs`
  WHERE `id` = @goal_run_id LIMIT 1
);

-- Update macro goal runs
UPDATE `macro_goal_runs`
SET `tenantId` = 'laundry_farm'
WHERE `id` = @goal_run_id AND `tenantId` = 'default';

-- Update operator macro goals
UPDATE `operator_macro_goals`
SET `tenantId` = 'laundry_farm'
WHERE `id` = @macro_goal_id AND `tenantId` = 'default';

-- Update goal cycle requests
UPDATE `goal_cycle_requests`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = @goal_run_id AND `tenantId` = 'default';

-- Update goal cycle decisions
UPDATE `goal_cycle_decisions`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = @goal_run_id AND `tenantId` = 'default';

-- Update goal cycle objectives
UPDATE `goal_cycle_objectives`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = @goal_run_id AND `tenantId` = 'default';

-- Update goal cycle outcomes
UPDATE `goal_cycle_outcomes`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = @goal_run_id AND `tenantId` = 'default';

-- Update goal cycle learned deltas
UPDATE `goal_cycle_learned_deltas`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = @goal_run_id AND `tenantId` = 'default';

-- Update goal cycle history
UPDATE `goal_cycle_history`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = @goal_run_id AND `tenantId` = 'default';

-- Update goal cycle dead letters
UPDATE `goal_cycle_dead_letters`
SET `tenantId` = 'laundry_farm'
WHERE `goalRunId` = @goal_run_id AND `tenantId` = 'default';

-- Update work threads associated with this goal
UPDATE `work_threads`
SET `tenantId` = 'laundry_farm'
WHERE (`firstSourceRef` LIKE CONCAT('%', @goal_run_id, '%')
       OR `opportunityJson` LIKE '%cleancloud%'
       OR `title` LIKE '%CleanCloud%')
  AND `tenantId` = 'default';

-- 5. Invalidate incorrectly branded drafts and reassign 16 CleanCloud recovery obligations
-- Reassigns to laundry_farm, sets status = 'scheduled', and clears draft = null
UPDATE `claire_proactive_obligations`
SET `tenantId` = 'laundry_farm',
    `status` = 'scheduled',
    `payloadJson` = JSON_SET(`payloadJson`, '$.draft', NULL)
WHERE `tenantId` = 'default'
  AND (`goalRunId` = @goal_run_id
       OR `kind` = 'dormant_recovery'
       OR `subjectKey` LIKE 'cleancloud:%'
       OR `payloadJson` LIKE '%CleanCloud%');

-- 6. Commercial accounts replication: replicate accounts (IDs 3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
-- into `laundry_farm` with identityKey prefix 'farm:', preserving existing records in `default`.
-- Preserves accounts #15 and #17 as distinct records.
INSERT INTO `commercial_accounts` (
  `tenantId`, `identityKey`, `name`, `accountType`, `providerName`, `providerAccountId`, `website`
)
SELECT
  'laundry_farm',
  CONCAT('farm:', COALESCE(`identityKey`, `id`)),
  `name`,
  `accountType`,
  `providerName`,
  `providerAccountId`,
  `website`
FROM `commercial_accounts`
WHERE `id` IN (3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
  AND `tenantId` = 'default'
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
  AND ca_farm.identityKey = CONCAT('farm:', COALESCE(ca_default.identityKey, ca_default.id))
WHERE ca_default.id IN (3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
ON DUPLICATE KEY UPDATE `label` = VALUES(`label`);

-- Replicate commercial account contacts
INSERT INTO `commercial_account_contacts` (
  `tenantId`, `accountId`, `contactKey`, `name`, `title`, `email`, `phone`, `relationshipType`
)
SELECT
  'laundry_farm',
  ca_farm.id,
  cac.contactKey,
  cac.name,
  cac.title,
  cac.email,
  cac.phone,
  cac.relationshipType
FROM `commercial_account_contacts` cac
JOIN `commercial_accounts` ca_default ON cac.accountId = ca_default.id AND cac.tenantId = 'default'
JOIN `commercial_accounts` ca_farm ON ca_farm.tenantId = 'laundry_farm'
  AND ca_farm.identityKey = CONCAT('farm:', COALESCE(ca_default.identityKey, ca_default.id))
WHERE ca_default.id IN (3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17)
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
