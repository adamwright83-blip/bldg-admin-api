CREATE TABLE IF NOT EXISTS `ops_tasks` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `lane` enum('lane_1','lane_2','lane_3','level_4') NOT NULL,
  `level` enum('1','2','3','4') NOT NULL,
  `taskType` enum('intake_missing_price','unpaid_order','vague_intake','missed_pickup','stale_customer','revenue_leak','referral_ask','vendor_followup','gm_followup','manual_operator_task','dry_clean_receipt_intake','emergency_task') NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `source` enum('manual','agent_suggested','system_detected','level_4','voice','quick_input') NOT NULL DEFAULT 'manual',
  `createdBy` varchar(128),
  `assignedTo` varchar(128),
  `status` enum('open','accepted','in_progress','completed','dismissed','expired') NOT NULL DEFAULT 'open',
  `priority` enum('low','normal','high','emergency') NOT NULL DEFAULT 'normal',
  `revenueAtRiskCents` int NOT NULL DEFAULT 0,
  `revenueRecoveredCents` int NOT NULL DEFAULT 0,
  `customerId` int,
  `orderId` int,
  `agentEventId` int,
  `metadataJson` json,
  `outcome` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `completedAt` timestamp,
  `completedBy` varchar(128),
  CONSTRAINT `ops_tasks_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ops_tasks_tenant_status` ON `ops_tasks` (`tenantId`,`status`);
--> statement-breakpoint
CREATE INDEX `idx_ops_tasks_tenant_lane` ON `ops_tasks` (`tenantId`,`lane`);
--> statement-breakpoint
CREATE INDEX `idx_ops_tasks_tenant_completed` ON `ops_tasks` (`tenantId`,`completedAt`);
--> statement-breakpoint
CREATE INDEX `idx_ops_tasks_agent_event` ON `ops_tasks` (`agentEventId`);
--> statement-breakpoint
CREATE INDEX `idx_ops_tasks_order` ON `ops_tasks` (`orderId`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ops_task_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `taskId` int NOT NULL,
  `eventType` enum('created','viewed','accepted','completed','dismissed','expired','agent_suggested','human_approved','revenue_recovered','outcome_recorded') NOT NULL,
  `actorType` enum('human','voice','resident_chat','driver','vendor','ai_agent','system') NOT NULL DEFAULT 'human',
  `actorId` varchar(128),
  `agentEventId` int,
  `beforeJson` json,
  `afterJson` json,
  `note` text,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `ops_task_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_ops_task_events_tenant_task` ON `ops_task_events` (`tenantId`,`taskId`);
--> statement-breakpoint
CREATE INDEX `idx_ops_task_events_tenant_event` ON `ops_task_events` (`tenantId`,`eventType`);
--> statement-breakpoint
CREATE INDEX `idx_ops_task_events_agent_event` ON `ops_task_events` (`agentEventId`);
