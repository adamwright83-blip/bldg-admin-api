CREATE TABLE `clearent_import_batches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `source` varchar(64) NOT NULL DEFAULT 'clearent_xplorpay',
  `sourceFileName` varchar(255) NOT NULL,
  `sourceReportBasis` enum('settled_date','entered_date','unknown') NOT NULL DEFAULT 'unknown',
  `importedRowCount` int NOT NULL DEFAULT 0,
  `skippedRowCount` int NOT NULL DEFAULT 0,
  `duplicateRowCount` int NOT NULL DEFAULT 0,
  `importStatus` enum('completed','completed_with_errors','failed') NOT NULL DEFAULT 'completed',
  `errorJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `clearent_import_batches_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clearent_transactions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `clearentTransactionId` varchar(128),
  `sourceFileName` varchar(255) NOT NULL,
  `importBatchId` int NOT NULL,
  `sourceReportBasis` enum('settled_date','entered_date','unknown') NOT NULL DEFAULT 'unknown',
  `merchantId` varchar(128),
  `merchantName` varchar(255),
  `transactionDateUtc` timestamp,
  `enteredDateUtc` timestamp,
  `settledDateUtc` timestamp,
  `depositDateUtc` timestamp,
  `cardType` varchar(64),
  `lastFour` varchar(4),
  `customerName` varchar(255),
  `customerEmail` varchar(320),
  `customerPhone` varchar(30),
  `grossAmountCents` int NOT NULL DEFAULT 0,
  `netAmountCents` int,
  `feeAmountCents` int,
  `depositAmountCents` int,
  `transactionStatus` varchar(100) NOT NULL DEFAULT 'unknown',
  `transactionType` varchar(100) NOT NULL DEFAULT 'unknown',
  `authCode` varchar(128),
  `batchId` varchar(128),
  `buildingName` varchar(255),
  `tower` varchar(100),
  `unit` varchar(50),
  `matchedOrderId` int,
  `matchedCustomerId` int,
  `rawJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `clearent_transactions_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_clearent_transaction_id` UNIQUE(`clearentTransactionId`)
);
--> statement-breakpoint
CREATE INDEX `idx_clearent_transactions_batch` ON `clearent_transactions` (`importBatchId`);
--> statement-breakpoint
CREATE INDEX `idx_clearent_transactions_entered` ON `clearent_transactions` (`enteredDateUtc`);
--> statement-breakpoint
CREATE INDEX `idx_clearent_transactions_settled` ON `clearent_transactions` (`settledDateUtc`);
--> statement-breakpoint
CREATE INDEX `idx_clearent_transactions_auth_match` ON `clearent_transactions` (`authCode`,`grossAmountCents`,`lastFour`);
--> statement-breakpoint
CREATE INDEX `idx_clearent_transactions_building` ON `clearent_transactions` (`buildingName`,`tower`);

-- Future: Clearent Deposits section currently has no export CTA. A later browser
-- automation pass may need to read the Deposits table and submit it through a
-- separate deposit ingestion path.
