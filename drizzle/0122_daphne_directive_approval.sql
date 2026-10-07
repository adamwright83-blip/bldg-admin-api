-- Daphne V2: Support explicit approval directive for LEARNING items
ALTER TABLE `operator_representative_directives`
  MODIFY COLUMN `directiveKind` enum('correction','suppress','ask_instead','approve') NOT NULL;
