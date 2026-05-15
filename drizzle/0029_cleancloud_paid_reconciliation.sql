CREATE TABLE `cleancloud_paid_orders` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `sourceReportType` enum('orders_sales','orders_revenue') NOT NULL,
  `sourceFileName` varchar(255) NOT NULL,
  `importBatchId` int NOT NULL,
  `cleancloudOrderId` varchar(128) NOT NULL,
  `cleancloudCustomerId` varchar(128),
  `customerName` varchar(255) NOT NULL,
  `customerEmail` varchar(320),
  `customerPhone` varchar(30),
  `address` text,
  `placedAtUtc` timestamp NULL,
  `paymentDateUtc` timestamp NULL,
  `paidDateUtc` timestamp NULL,
  `readyByDateUtc` timestamp NULL,
  `collectedAtUtc` timestamp NULL,
  `cleanedAtUtc` timestamp NULL,
  `orderStatus` varchar(100),
  `paid` boolean NOT NULL DEFAULT false,
  `paymentType` varchar(100),
  `cardPaymentType` varchar(100),
  `totalCents` int NOT NULL DEFAULT 0,
  `subtotalCents` int,
  `discountCents` int,
  `creditCents` int,
  `totalWeightLbs` decimal(8,2),
  `summaryText` text,
  `buildingName` varchar(255),
  `buildingSlug` varchar(100),
  `tower` varchar(100),
  `unit` varchar(50),
  `buildingResolutionStatus` enum('resolved','unresolved_needs_mapping','not_applicable') NOT NULL,
  `rawJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `cleancloud_paid_orders_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_cleancloud_paid_order_report` UNIQUE(`cleancloudOrderId`,`sourceReportType`)
);

CREATE INDEX `idx_cleancloud_paid_orders_batch` ON `cleancloud_paid_orders` (`importBatchId`);
CREATE INDEX `idx_cleancloud_paid_orders_payment_date` ON `cleancloud_paid_orders` (`paymentDateUtc`);
CREATE INDEX `idx_cleancloud_paid_orders_paid_date` ON `cleancloud_paid_orders` (`paidDateUtc`);
CREATE INDEX `idx_cleancloud_paid_orders_customer` ON `cleancloud_paid_orders` (`cleancloudCustomerId`,`customerName`);
CREATE INDEX `idx_cleancloud_paid_orders_building` ON `cleancloud_paid_orders` (`buildingSlug`,`tower`);

CREATE TABLE `payment_reconciliation_matches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `processor` enum('clearent','stripe','manual') NOT NULL,
  `processorSourceType` enum('clearent_daily_summary','clearent_transaction','stripe_payment') NOT NULL,
  `processorSourceId` varchar(128),
  `orderSource` enum('cleancloud_orders_sales','cleancloud_orders_revenue','bldg','manual') NOT NULL,
  `orderId` int,
  `cleancloudOrderId` varchar(128),
  `cleancloudCustomerId` varchar(128),
  `customerName` varchar(255),
  `customerEmail` varchar(320),
  `customerPhone` varchar(30),
  `buildingName` varchar(255),
  `buildingSlug` varchar(100),
  `tower` varchar(100),
  `unit` varchar(50),
  `matchedAmountCents` int NOT NULL DEFAULT 0,
  `matchStatus` enum('customer_match','date_total_match','manual_match','possible_duplicate','unmatched','needs_review','ignored') NOT NULL,
  `matchConfidence` enum('high','medium','low') NOT NULL,
  `matchReason` text NOT NULL,
  `localBusinessDate` varchar(20) NOT NULL,
  `rawJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `payment_reconciliation_matches_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_payment_reconciliation_source_date` ON `payment_reconciliation_matches` (`processor`,`processorSourceType`,`processorSourceId`,`localBusinessDate`);
CREATE INDEX `idx_payment_reconciliation_status` ON `payment_reconciliation_matches` (`matchStatus`);
CREATE INDEX `idx_payment_reconciliation_customer` ON `payment_reconciliation_matches` (`cleancloudCustomerId`,`customerName`);
CREATE INDEX `idx_payment_reconciliation_building` ON `payment_reconciliation_matches` (`buildingSlug`,`tower`);
