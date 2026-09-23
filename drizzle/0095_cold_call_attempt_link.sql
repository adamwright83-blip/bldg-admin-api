-- Link a Goldline Cold Call Burst transport attempt to its owned target.
-- Nullable so existing Saleslay Bold Pitch rows stay unchanged.
-- sales_call_attempts remains provider-call truth.
-- The commercial outcome stays on the commercial mission call-attempt path.

ALTER TABLE `sales_call_attempts`
  ADD COLUMN `cold_call_target_id` varchar(36) NULL;

CREATE INDEX `sales_call_attempts_cold_call_target_idx`
  ON `sales_call_attempts` (`tenant_id`, `cold_call_target_id`);
