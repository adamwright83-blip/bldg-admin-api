-- Claire conversation ledger + Goldline-owned post-call analysis.
-- Additive only. Does not alter business-truth tables.
-- Transcript / analysis / recording are NOT business truth.
-- Hand-written to match this repo's manual migration convention.

CREATE TABLE IF NOT EXISTS `claire_conversation_sessions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `provider` varchar(32) NOT NULL DEFAULT 'twilio',
  `providerCallSid` varchar(64) NULL,
  `claireConversationId` varchar(36) NOT NULL,
  `conversationKind` varchar(32) NOT NULL,
  `missionId` int NULL,
  `relatedActionIdsJson` json NOT NULL,
  `status` varchar(32) NOT NULL,
  `completionReason` varchar(64) NULL,
  `recordingStatus` varchar(32) NOT NULL,
  `transcriptionStatus` varchar(32) NOT NULL,
  `analysisStatus` varchar(32) NOT NULL,
  `notificationStatus` varchar(32) NOT NULL,
  `recordingConsent` varchar(32) NOT NULL,
  `recordingSid` varchar(64) NULL,
  `recordingDurationSeconds` int NULL,
  `recordingChannels` varchar(16) NULL,
  `recordingTrack` varchar(16) NULL,
  `recordingProviderUrl` varchar(512) NULL,
  `audioStorageProvider` varchar(32) NULL,
  `audioStorageKey` varchar(512) NULL,
  `audioCompletedAt` timestamp NULL,
  `audioRetainUntil` timestamp NULL,
  `transcriptRetainUntil` timestamp NULL,
  `analysisRetainUntil` timestamp NULL,
  `claireCompilerVersion` varchar(32) NULL,
  `claireCharacterVersion` varchar(32) NULL,
  `llmModel` varchar(64) NULL,
  `voiceProvider` varchar(32) NULL,
  `voiceName` varchar(64) NULL,
  `gitSha` varchar(64) NULL,
  `frontendRelease` varchar(64) NULL,
  `startedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `endedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_conversation_claire_id` (`claireConversationId`),
  UNIQUE KEY `uq_claire_conversation_call_sid` (`providerCallSid`),
  UNIQUE KEY `uq_claire_conversation_recording_sid` (`recordingSid`),
  KEY `idx_claire_conversation_operator` (`tenantId`,`operatorUserId`,`startedAt`),
  KEY `idx_claire_conversation_pipeline` (`tenantId`,`analysisStatus`,`notificationStatus`)
);

CREATE TABLE IF NOT EXISTS `claire_conversation_turns` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `sessionId` varchar(36) NOT NULL,
  `ordinal` int NOT NULL,
  `speaker` varchar(16) NOT NULL,
  `text` text NOT NULL,
  `source` varchar(32) NOT NULL,
  `idempotencyKey` varchar(64) NOT NULL,
  `providerMetadataJson` json NULL,
  `occurredAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_conversation_turn_idempotency` (`idempotencyKey`),
  UNIQUE KEY `uq_claire_conversation_turn_ordinal` (`sessionId`,`ordinal`),
  KEY `idx_claire_conversation_turns_session` (`sessionId`,`ordinal`)
);

CREATE TABLE IF NOT EXISTS `claire_conversation_transcripts` (
  `id` bigint AUTO_INCREMENT NOT NULL,
  `sessionId` varchar(36) NOT NULL,
  `source` varchar(32) NOT NULL,
  `provider` varchar(32) NOT NULL,
  `providerVersion` varchar(64) NULL,
  `text` mediumtext NOT NULL,
  `payloadJson` json NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_conversation_transcript_source` (`sessionId`,`source`),
  KEY `idx_claire_conversation_transcript_session` (`sessionId`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `claire_conversation_analyses` (
  `id` varchar(36) NOT NULL,
  `sessionId` varchar(36) NOT NULL,
  `evaluatorVersion` varchar(32) NOT NULL,
  `model` varchar(64) NOT NULL,
  `researchFlag` varchar(32) NOT NULL,
  `resultJson` json NOT NULL,
  `summaryText` text NOT NULL,
  `copyBundleText` mediumtext NOT NULL,
  `acceptedActionCount` int NOT NULL DEFAULT 0,
  `completedActionCount` int NOT NULL DEFAULT 0,
  `outcomeCount` int NOT NULL DEFAULT 0,
  `humanReviewStatus` varchar(32) NOT NULL DEFAULT 'unreviewed',
  `humanFeedbackKind` varchar(32) NULL,
  `humanFeedbackNote` varchar(512) NULL,
  `reviewedAt` timestamp NULL,
  `reviewedByUserId` varchar(128) NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_conversation_analysis_session` (`sessionId`),
  KEY `idx_claire_conversation_analysis_review` (`humanReviewStatus`,`createdAt`)
);

CREATE TABLE IF NOT EXISTS `claire_conversation_notifications` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `operatorUserId` varchar(128) NOT NULL,
  `sessionId` varchar(36) NOT NULL,
  `kind` varchar(48) NOT NULL,
  `title` varchar(191) NOT NULL,
  `body` varchar(512) NOT NULL,
  `ctaLabel` varchar(64) NOT NULL,
  `href` varchar(255) NOT NULL,
  `readAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_claire_conversation_notification_kind` (`sessionId`,`kind`),
  KEY `idx_claire_conversation_notification_inbox` (`tenantId`,`operatorUserId`,`createdAt`)
);
