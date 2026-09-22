-- Goldline Twilio platform, Slice 1.
-- One communications receipt log. Not a Twilio product table.
-- Provider retries must not insert a second row.
-- A receipt is not a sale, a mission, WeeklyIntent, Daily Command, or a Narrator event.

CREATE TABLE IF NOT EXISTS `communication_receipts` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NULL,
  `provider` varchar(32) NOT NULL DEFAULT 'twilio',
  `providerEventId` varchar(191) NULL,
  `eventType` varchar(64) NOT NULL,
  `callSid` varchar(64) NULL,
  `parentCallSid` varchar(64) NULL,
  `messageSid` varchar(64) NULL,
  `direction` varchar(16) NULL,
  `fromNumber` varchar(64) NULL,
  `toNumber` varchar(64) NULL,
  `status` varchar(64) NULL,
  `startedAt` timestamp NULL DEFAULT NULL,
  `answeredAt` timestamp NULL DEFAULT NULL,
  `completedAt` timestamp NULL DEFAULT NULL,
  `durationSeconds` int NULL,
  `providerErrorCode` varchar(32) NULL,
  `providerErrorMessage` varchar(512) NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_communication_receipts_idempotency` (`idempotencyKey`),
  UNIQUE KEY `uq_communication_receipts_provider_event` (`provider`, `providerEventId`),
  KEY `idx_communication_receipts_call` (`tenantId`, `callSid`, `eventType`),
  KEY `idx_communication_receipts_message` (`tenantId`, `messageSid`, `eventType`)
);
