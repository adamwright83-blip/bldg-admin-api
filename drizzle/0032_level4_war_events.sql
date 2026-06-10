CREATE TABLE `level4_war_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` varchar(64) NOT NULL DEFAULT 'default',
	`kind` varchar(48) NOT NULL,
	`dedupeKey` varchar(191) NOT NULL,
	`pushHundredths` int NOT NULL DEFAULT 0,
	`metadata` json,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `level4_war_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_level4_war_events_tenant_dedupe` UNIQUE(`tenantId`,`dedupeKey`)
);
--> statement-breakpoint
CREATE INDEX `idx_level4_war_events_tenant_created` ON `level4_war_events` (`tenantId`,`createdAt`);
