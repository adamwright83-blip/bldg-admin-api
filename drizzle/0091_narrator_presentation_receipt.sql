-- Narrator OS slice H. Presentation receipts are not story occurrence.
-- `prepared` and `rendered_to_surface` record the presentation boundary.
-- They are not human perception and they are not FIRED_AUTHORED_BEAT.

CREATE TABLE IF NOT EXISTS `narrator_os_presentation_receipt` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `occurrenceLedgerEntryId` varchar(36) NOT NULL,
  `beatId` varchar(64) NOT NULL,
  `presentationId` varchar(96) NOT NULL,
  `status` enum('prepared','rendered_to_surface') NOT NULL,
  `preparedAt` timestamp NOT NULL,
  `renderedAt` timestamp NULL DEFAULT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_narrator_os_presentation_occurrence` (`tenantId`, `operatorUserId`, `occurrenceLedgerEntryId`),
  UNIQUE KEY `uq_narrator_os_presentation_idempotency` (`tenantId`, `idempotencyKey`),
  KEY `idx_narrator_os_presentation_operator` (`tenantId`, `operatorUserId`)
);
