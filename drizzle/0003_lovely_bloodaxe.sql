ALTER TABLE `orders` ADD `tenantId` varchar(64) DEFAULT 'default';--> statement-breakpoint
ALTER TABLE `users` ADD `tenantId` varchar(64) DEFAULT 'default';