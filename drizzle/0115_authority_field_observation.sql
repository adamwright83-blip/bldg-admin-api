-- JOYSTICK Authority Receipt: persisted human field observation testimony.
ALTER TABLE `authority_receipts`
  MODIFY COLUMN `claimType`
    enum('payment_verified','account_won','message_sent','action_completed','field_observation_attested') NOT NULL;
