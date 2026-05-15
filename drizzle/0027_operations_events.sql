CREATE TABLE `operations_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `businessUnitLabel` varchar(128) NOT NULL,
  `source` enum('driver_app_bldg','cleancloud_csv','cleancloud_playbook','system_backfill') NOT NULL,
  `sourceEventType` enum('pickup_completed','dropoff_completed') NOT NULL,
  `eventStatus` enum('completed','corrected','voided') NOT NULL DEFAULT 'completed',
  `orderId` int,
  `customerName` varchar(255) NOT NULL,
  `customerPhone` varchar(30),
  `customerEmail` varchar(320),
  `serviceType` varchar(64) NOT NULL,
  `buildingName` varchar(255),
  `buildingSlug` varchar(100),
  `tower` varchar(100),
  `buildingResolutionStatus` enum('resolved','unresolved_needs_mapping','not_applicable') NOT NULL,
  `unit` varchar(50),
  `scheduledDate` varchar(20),
  `scheduledWindow` varchar(50),
  `actualEventTimestamp` timestamp NOT NULL,
  `actorUserId` varchar(128),
  `actorDisplayName` varchar(255),
  `vendorId` int,
  `bagCount` int,
  `garmentCount` int,
  `weightLbs` decimal(8,2),
  `rawJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `operations_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_operations_events_source_type_order` UNIQUE(`source`,`sourceEventType`,`orderId`)
);
--> statement-breakpoint
CREATE INDEX `idx_operations_events_tenant_time` ON `operations_events` (`tenantId`,`actualEventTimestamp`);
--> statement-breakpoint
CREATE INDEX `idx_operations_events_order` ON `operations_events` (`orderId`);
--> statement-breakpoint
CREATE INDEX `idx_operations_events_building` ON `operations_events` (`buildingSlug`,`tower`);
--> statement-breakpoint
CREATE INDEX `idx_operations_events_resolution` ON `operations_events` (`buildingResolutionStatus`);
