CREATE TABLE `cleancloud_import_batches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `source` varchar(64) NOT NULL DEFAULT 'cleancloud',
  `sourceFileName` varchar(255) NOT NULL,
  `importedRowCount` int NOT NULL DEFAULT 0,
  `skippedRowCount` int NOT NULL DEFAULT 0,
  `duplicateRowCount` int NOT NULL DEFAULT 0,
  `importStatus` enum('completed','completed_with_errors','failed') NOT NULL DEFAULT 'completed',
  `errorJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `cleancloud_import_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `cleancloud_legacy_orders` (
  `id` int AUTO_INCREMENT NOT NULL,
  `cleancloudOrderId` varchar(128),
  `sourceFileName` varchar(255) NOT NULL,
  `importBatchId` int NOT NULL,
  `customerName` varchar(255) NOT NULL,
  `customerEmail` varchar(320),
  `customerPhone` varchar(30),
  `orderDateUtc` timestamp NOT NULL,
  `completedDateUtc` timestamp,
  `orderStatus` varchar(100) NOT NULL,
  `orderTotalCents` int NOT NULL DEFAULT 0,
  `paymentStatus` varchar(100) NOT NULL,
  `serviceType` varchar(100) NOT NULL,
  `buildingName` varchar(255),
  `tower` varchar(100),
  `unit` varchar(50),
  `rawJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `cleancloud_legacy_orders_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_cleancloud_legacy_order_id` UNIQUE(`cleancloudOrderId`)
);
--> statement-breakpoint
CREATE INDEX `idx_cleancloud_legacy_orders_batch` ON `cleancloud_legacy_orders` (`importBatchId`);
--> statement-breakpoint
CREATE INDEX `idx_cleancloud_legacy_orders_customer_order` ON `cleancloud_legacy_orders` (`customerName`,`orderDateUtc`,`orderTotalCents`);
--> statement-breakpoint
CREATE INDEX `idx_cleancloud_legacy_orders_building` ON `cleancloud_legacy_orders` (`buildingName`,`tower`);
