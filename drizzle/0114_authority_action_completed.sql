-- JOYSTICK Authority Receipt next slice: persisted real-world field action completion.
ALTER TABLE `authority_receipts`
  MODIFY COLUMN `claimType`
    enum('payment_verified','account_won','message_sent','action_completed') NOT NULL;
