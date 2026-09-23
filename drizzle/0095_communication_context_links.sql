-- Goldline communications analytics, explicit linkage slice.
-- Additive. No historical backfill. Provider SIDs are not Goldline entity IDs.
-- A context link states how the relationship was proven.
-- Allowed sources: direct_provider_link, claire_session_link,
-- explicit_mission_link, explicit_action_link, explicit_campaign_link,
-- explicit_order_link.

CREATE TABLE IF NOT EXISTS `communication_context_links` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `providerResourceSid` varchar(64) NOT NULL,
  `resourceKind` varchar(16) NOT NULL,
  `partyClass` varchar(64) NULL,
  `goldlineEntityKind` varchar(32) NULL,
  `goldlineEntityId` varchar(128) NULL,
  `source` varchar(32) NOT NULL,
  `proof` varchar(191) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_communication_context_links_idempotency` (`idempotencyKey`),
  KEY `idx_communication_context_links_resource` (`tenantId`, `providerResourceSid`),
  KEY `idx_communication_context_links_entity` (`tenantId`, `goldlineEntityKind`, `goldlineEntityId`)
);

-- Window scans over communication_receipts by tenant and createdAt.
ALTER TABLE `communication_receipts`
  ADD KEY `idx_communication_receipts_tenant_created` (`tenantId`, `createdAt`);
