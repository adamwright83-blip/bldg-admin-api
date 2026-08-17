-- FIELD INTEL CAPTURE.
--
-- The design constraint that shapes everything here: a brand-new kind of
-- real-world observation must be storable the moment the operator realises it
-- matters — mid-day, in the field, with no migration and no deploy.
--
-- So the SCHEMA is stable and the VOCABULARY is open. Every signal is
-- (signalKey, value, provenance, when, what it was about). "Start tracking
-- whether buildings allow solicitation" creates a new `signalKey`, never a new
-- column. There are deliberately no per-observation columns in this table and
-- there never should be: the day someone adds `has_package_lockers BOOLEAN` is
-- the day this stops working for the next unanticipated thing.
--
-- `metadataJson` holds structured detail that has no column and does not
-- deserve one. It is the escape valve that keeps the columns stable.
CREATE TABLE `impact_signals` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',

  -- Ties a signal to a push, so ten operating days can be analysed as one run.
  -- A loose string rather than a foreign key: the campaign concept lives in
  -- another subsystem, and coupling capture to it would mean field intel could
  -- not be recorded when that subsystem had no row yet.
  `campaignId` varchar(64) NULL,
  `businessDate` varchar(10) NOT NULL,

  -- The open vocabulary. `signalKey` is the stable machine identity;
  -- `label` and `valueType` are stored PER ROW as well as on the definition,
  -- so promoting a key to a standard question later never has to rewrite
  -- history to stay readable.
  `signalKey` varchar(96) NOT NULL,
  `label` varchar(191) NOT NULL,
  `valueType` enum('text','number','boolean','enum','date') NOT NULL DEFAULT 'text',
  `value` text NOT NULL,
  `unit` varchar(32) NULL,

  -- The truth-preserving pair. `impactClass` is the funnel position and is
  -- never inferred upward from what the operator said; `provenance` is where
  -- the information came from and is never upgraded at all.
  `impactClass` enum(
    'observation','field_activity','response',
    'opportunity','customer_outcome','economic_outcome'
  ) NOT NULL DEFAULT 'observation',
  `provenance` enum('system_verified','operator_confirmed','external_record')
    NOT NULL DEFAULT 'operator_confirmed',

  -- What the signal is about. Untyped on purpose: a signal may concern a
  -- building, an account, a person, or something that has no table yet.
  `entityType` varchar(64) NULL,
  `entityId` varchar(64) NULL,
  `entityLabel` varchar(191) NULL,
  `location` varchar(512) NULL,

  `notes` text NULL,
  `metadataJson` json NULL,

  `capturedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Null until a person confirms it. An unconfirmed signal is a proposal and
  -- the ledger does not count it.
  `confirmedAt` timestamp NULL,

  CONSTRAINT `impact_signals_id` PRIMARY KEY (`id`),
  INDEX `idx_impact_signal_campaign` (`tenantId`, `campaignId`, `businessDate`),
  INDEX `idx_impact_signal_key` (`tenantId`, `signalKey`, `businessDate`),
  INDEX `idx_impact_signal_entity` (`entityType`, `entityId`)
);

-- Reusable questions the operator has decided are worth asking repeatedly.
--
-- Additive only. Promotion sets `promoted` and changes what future objectives
-- ask; it never touches captured signals, because each of those already
-- carries its own key, label and value type.
CREATE TABLE `tracked_signal_definitions` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `signalKey` varchar(96) NOT NULL,
  `label` varchar(191) NOT NULL,
  `valueType` enum('text','number','boolean','enum','date') NOT NULL DEFAULT 'text',
  `impactClass` enum(
    'observation','field_activity','response',
    'opportunity','customer_outcome','economic_outcome'
  ) NOT NULL DEFAULT 'observation',
  `appliesTo` varchar(64) NULL,
  `unit` varchar(32) NULL,
  `optionsJson` json NULL,
  -- Whether this is offered as a standard question yet. Counting observations
  -- is enough for a human to decide; automatic promotion is deliberately out
  -- of scope for this pass.
  `promoted` boolean NOT NULL DEFAULT false,
  `observedCount` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT `tracked_signal_definitions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_tracked_signal_key` UNIQUE (`tenantId`, `signalKey`)
);
