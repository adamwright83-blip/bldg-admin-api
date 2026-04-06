-- Expand admin_action_log.status for honest operational vs collection semantics.
-- Step 1: add new enum values alongside legacy `success`.
ALTER TABLE `admin_action_log`
  MODIFY COLUMN `status` ENUM(
    'success',
    'failed',
    'reversed',
    'attempted',
    'delivered',
    'paid'
  ) NOT NULL;

-- Step 2: migrate legacy rows (historical "success" = operational attempt logged, not cash collected).
UPDATE `admin_action_log` SET `status` = 'attempted' WHERE `status` = 'success';

-- Step 3: drop legacy label `success`.
ALTER TABLE `admin_action_log`
  MODIFY COLUMN `status` ENUM(
    'attempted',
    'delivered',
    'failed',
    'paid',
    'reversed'
  ) NOT NULL;
