-- JOYSTICK Authority Receipt slice: payment, account won, provider message sent.
-- Domain records stay in their existing tables. This table is the common
-- admission receipt, not a replacement database.

CREATE TABLE IF NOT EXISTS `authority_receipts` (
  `id` varchar(64) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `claimType` enum('payment_verified','account_won','message_sent') NOT NULL,
  `subjectType` varchar(64) NOT NULL,
  `subjectId` varchar(191) NOT NULL,
  `sourceType` varchar(64) NOT NULL,
  `sourceRef` varchar(191) NOT NULL,
  `actorType` varchar(32) NOT NULL,
  `actorId` varchar(191) NULL,
  `evidenceClass` enum('authoritative_external','operator_attested') NOT NULL,
  `verificationClass` enum('VERIFIED','ATTESTED') NOT NULL,
  `admissionPolicy` varchar(96) NOT NULL,
  `occurredAt` timestamp(3) NULL,
  `admittedAt` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `metadataJson` json NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_authority_receipts_idempotency` (`tenantId`,`idempotencyKey`),
  KEY `idx_authority_receipts_subject` (`tenantId`,`claimType`,`subjectType`,`subjectId`,`admittedAt`),
  KEY `idx_authority_receipts_source` (`tenantId`,`sourceType`,`sourceRef`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
