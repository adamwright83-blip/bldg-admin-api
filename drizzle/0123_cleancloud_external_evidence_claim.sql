-- Boundary 6: CleanCloud external paid observation is not native payment authority.
-- Additive only: existing receipts are retained unchanged.
ALTER TABLE `authority_receipts`
  MODIFY COLUMN `claimType`
    enum(
      'payment_verified',
      'cleancloud_paid_observed',
      'account_won',
      'message_sent',
      'action_completed',
      'field_observation_attested'
    ) NOT NULL;
