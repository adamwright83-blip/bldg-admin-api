-- Allow admin_action_log rows to reference a building entity (Level 4 Offensive Growth).
-- Expands the entityType enum from ('order','customer') to ('order','customer','building').
ALTER TABLE `admin_action_log`
  MODIFY COLUMN `entityType` ENUM(
    'order',
    'customer',
    'building'
  ) NOT NULL;
