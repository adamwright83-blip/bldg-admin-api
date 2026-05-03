ALTER TABLE `orders` MODIFY COLUMN `status` enum('new','intake-pending','collected','processing','ready','delivered') NOT NULL DEFAULT 'new';

CREATE TABLE `agent_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `sessionId` varchar(128),
  `conversationId` varchar(128),
  `agentType` enum('resident_agent','operator_voice_agent','vendor_agent','driver_agent','gm_agent','building_agent','collections_agent') NOT NULL,
  `actorType` enum('human','voice','resident_chat','driver','vendor','ai_agent','system') NOT NULL,
  `actorId` varchar(128),
  `toolName` varchar(128) NOT NULL,
  `entityType` varchar(64),
  `entityId` varchar(128),
  `inputJson` json,
  `outputJson` json,
  `status` enum('success','failed','approval_required','blocked') NOT NULL,
  `errorMessage` text,
  `latencyMs` int,
  `modelUsed` varchar(128),
  `inputTokens` int NOT NULL DEFAULT 0,
  `outputTokens` int NOT NULL DEFAULT 0,
  `estimatedCostCents` int NOT NULL DEFAULT 0,
  `requiresHumanApproval` boolean NOT NULL DEFAULT false,
  `approvedByUserId` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `agent_events_id` PRIMARY KEY(`id`)
);

CREATE TABLE `tenant_ai_usage` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `month` varchar(7) NOT NULL,
  `inputTokens` int NOT NULL DEFAULT 0,
  `outputTokens` int NOT NULL DEFAULT 0,
  `estimatedCostCents` int NOT NULL DEFAULT 0,
  `requestCount` int NOT NULL DEFAULT 0,
  `warningLimitCents` int NOT NULL DEFAULT 5000,
  `hardLimitCents` int NOT NULL DEFAULT 10000,
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tenant_ai_usage_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_tenant_ai_usage_tenant_month` UNIQUE(`tenantId`,`month`)
);
