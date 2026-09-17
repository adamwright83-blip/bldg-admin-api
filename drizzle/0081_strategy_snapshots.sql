-- Drizzle migration: strategy_snapshots (Slice 4)
CREATE TABLE IF NOT EXISTS `strategy_snapshots` (
  `id` VARCHAR(64) NOT NULL PRIMARY KEY,
  `tenantId` VARCHAR(64) NOT NULL,
  `schemaVersion` INT NOT NULL DEFAULT 1,
  `contentHash` VARCHAR(64) NOT NULL,
  `estimatedTokens` INT NOT NULL DEFAULT 0,
  `isTruncated` BOOLEAN NOT NULL DEFAULT FALSE,
  `payloadJson` JSON NOT NULL,
  `provenanceJson` JSON NOT NULL,
  `stalenessJson` JSON NOT NULL,
  `generatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `idx_strategy_snapshots_tenant_created` (`tenantId`, `createdAt`),
  KEY `idx_strategy_snapshots_tenant_hash` (`tenantId`, `contentHash`)
);
