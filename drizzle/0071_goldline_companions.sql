-- Slice 3: companion roster + per-operator earned state.
-- Roster rows are the protected may/may-not contract as data, sourced
-- verbatim from docs/goldline/REALITY_BRIDGE.md. Unlock rows are only
-- written after real evidence of completing the earning campaign.

CREATE TABLE IF NOT EXISTS `goldline_companions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `companionId` varchar(32) NOT NULL,
  `name` varchar(64) NOT NULL,
  `fictionTruth` varchar(512) NOT NULL,
  `afterAvailableText` varchar(512) NOT NULL,
  `mayJson` json NOT NULL,
  `mayNotJson` json NOT NULL,
  `fantasyExpressionJson` json NOT NULL,
  `abilityId` varchar(64) NOT NULL,
  `abilityDescription` varchar(512) NOT NULL,
  `unifiedProductPersona` boolean NOT NULL DEFAULT false,
  `productPersonaNote` varchar(512) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_companion_id` (`tenantId`,`companionId`)
);

CREATE TABLE IF NOT EXISTS `goldline_companion_unlocks` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorId` varchar(128) NOT NULL,
  `companionId` varchar(32) NOT NULL,
  `earnedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `earnedViaKingdomId` varchar(64) NOT NULL,
  `earnedViaCampaignId` varchar(64) NOT NULL,
  `evidenceOpsTaskId` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_goldline_companion_unlock` (`tenantId`,`operatorId`,`companionId`)
);
