CREATE TABLE `clearent_daily_summaries` (
  `id` int AUTO_INCREMENT NOT NULL,
  `sourceFileName` varchar(255) NOT NULL,
  `importBatchId` int NOT NULL,
  `sourceReportBasis` enum('settled_date','entered_date','unknown') NOT NULL DEFAULT 'unknown',
  `reportDateUtc` timestamp NOT NULL,
  `totalSalesCents` int NOT NULL DEFAULT 0,
  `netSalesCents` int,
  `totalTransactions` int,
  `interchangeCents` int,
  `discountCents` int,
  `depositAmountCents` int,
  `rawJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `clearent_daily_summaries_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_clearent_daily_summary_basis_date` UNIQUE(`sourceReportBasis`,`reportDateUtc`)
);
--> statement-breakpoint
CREATE INDEX `idx_clearent_daily_summaries_batch` ON `clearent_daily_summaries` (`importBatchId`);
--> statement-breakpoint
CREATE INDEX `idx_clearent_daily_summaries_report_date` ON `clearent_daily_summaries` (`reportDateUtc`);
