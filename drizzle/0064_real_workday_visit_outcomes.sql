ALTER TABLE `commercial_visit_outcomes`
  MODIFY COLUMN `outcome` enum('follow_up','won','lost','no_contact','no_decision') NOT NULL;
