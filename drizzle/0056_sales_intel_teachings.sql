-- General sales teaching corpus — broadens Sales Intel beyond objection
-- frameworks. Purely additive: one new table, no changes to any existing
-- table. `sales_intel_frameworks` (objection-handling frameworks) is
-- completely untouched by this migration and remains the driver-facing
-- Armory contract exactly as before.

CREATE TABLE IF NOT EXISTS `sales_intel_teachings` (
  `id` varchar(36) NOT NULL,
  `sourceArtifactId` varchar(36) NOT NULL,
  `transcriptId` varchar(36) NOT NULL,
  `teachingKey` varchar(64) NOT NULL,
  `creatorName` varchar(191) NOT NULL,
  `creatorHandle` varchar(191) NULL,
  `category` enum(
    'prospecting','opening','positioning','rapport','discovery',
    'qualification','questioning','value','pricing',
    'objection_prevention','objection_handling','negotiation','closing',
    'follow_up','re_engagement','sales_process','sales_psychology','other'
  ) NOT NULL,
  `title` varchar(191) NOT NULL,
  `principle` text NOT NULL,
  `whenToUseJson` json NOT NULL,
  `whenNotToUseJson` json NOT NULL,
  `exampleLanguageJson` json NOT NULL,
  `confidence` decimal(4,3) NULL,
  `extractionVersion` varchar(96) NOT NULL,
  `extractionProvider` varchar(96) NULL,
  `extractionModel` varchar(96) NULL,
  `promptVersion` varchar(96) NULL,
  `transcriptStartMs` int NULL,
  `transcriptEndMs` int NULL,
  `reviewState` enum('review_required','accepted','rejected') NOT NULL DEFAULT 'review_required',
  `reviewedBy` varchar(128) NULL,
  `reviewedAt` timestamp NULL,
  `version` int NOT NULL DEFAULT 1,
  `active` boolean NOT NULL DEFAULT true,
  `supersededAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `sales_intel_teachings_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_sales_intel_teaching_version` UNIQUE (`teachingKey`, `version`),
  INDEX `idx_sales_intel_teaching_source` (`sourceArtifactId`, `createdAt`),
  INDEX `idx_sales_intel_teaching_transcript` (`transcriptId`),
  INDEX `idx_sales_intel_teaching_lookup` (`category`, `reviewState`, `active`)
);
