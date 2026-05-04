ALTER TABLE `vendor_onboarding_sessions`
  ADD COLUMN `publicSourceUrl` varchar(512);

CREATE INDEX `idx_vendor_onboarding_sessions_tenant_session`
  ON `vendor_onboarding_sessions` (`tenantId`, `sessionId`);

CREATE TABLE `vendor_onboarding_messages` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `sessionId` int NOT NULL,
  `conversationId` varchar(128),
  `role` enum('vendor','agent','system') NOT NULL,
  `content` text NOT NULL,
  `metadataJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `vendor_onboarding_messages_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_vendor_onboarding_messages_tenant_session`
  ON `vendor_onboarding_messages` (`tenantId`, `sessionId`);
