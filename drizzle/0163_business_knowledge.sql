-- Business knowledge: JOYSTICK's dated, evidence-backed understanding of the businesses, brands, products, projects
-- and people in a person's working life, built during onboarding and kept current afterwards.
--
-- It owns reconciled understanding only. It is not a second accounting system: nothing here is a transaction, an
-- order, a customer record or a payment, and a relationship between two business names (even one the person
-- confirmed) never authorises merging financial records (`authorizes_financial_merge` is always 0).
--
-- Every row belongs to one first-ten journey (`journey_id`, the person's own scope before their workspace exists)
-- and, once the workspace is provisioned, to that tenant (`tenant_id`). Reads always filter by both once bound.
--
-- Separation of kinds of truth:
--   business_knowledge_evidence    what a source said (a short redacted excerpt, never a whole document)
--   business_knowledge_timeline    what happened, when, according to which evidence (direct / inferred / confirmed)
--   business_knowledge_assertions  what JOYSTICK concludes or the person confirmed: versioned; superseded, never
--                                  overwritten; a person's confirmation is never superseded by an inference
--   business_knowledge_questions   what JOYSTICK asked the person, their words, and what it resolved
--   business_knowledge_runs        each investigation: budget, what was searched, coverage and its gaps; while one
--                                  runs, running_key = 'running', unique per journey, so only one can (NULLs repeat)
--
-- Applied by scripts/migrate.mjs; idempotent (CREATE TABLE IF NOT EXISTS). Nothing existing is altered.
CREATE TABLE IF NOT EXISTS `business_knowledge_entities` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NULL,
  `kind` varchar(24) NOT NULL,
  `name` varchar(255) NOT NULL,
  `name_key` varchar(191) NOT NULL,
  `aliases_json` json NULL,
  `email` varchar(320) NULL,
  `domain` varchar(191) NULL,
  `canonical_ref` varchar(191) NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bk_entities_name` (`journey_id`, `kind`, `name_key`),
  KEY `idx_bk_entities_tenant` (`tenant_id`, `journey_id`)
);
CREATE TABLE IF NOT EXISTS `business_knowledge_evidence` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NULL,
  `provider` varchar(16) NOT NULL,
  `source_ref` varchar(191) NOT NULL,
  `locator` varchar(191) NOT NULL DEFAULT '',
  `label` varchar(255) NOT NULL,
  `excerpt` varchar(500) NOT NULL,
  `url` varchar(500) NULL,
  `occurred_at` timestamp NULL,
  `discovered_at` timestamp NOT NULL,
  `last_seen_at` timestamp NOT NULL,
  `run_id` varchar(36) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bk_evidence_source` (`journey_id`, `provider`, `source_ref`, `locator`),
  KEY `idx_bk_evidence_tenant` (`tenant_id`, `journey_id`)
);
CREATE TABLE IF NOT EXISTS `business_knowledge_timeline` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NULL,
  `entity_id` varchar(36) NOT NULL,
  `related_entity_id` varchar(36) NULL,
  `kind` varchar(32) NOT NULL,
  `signal` varchar(24) NOT NULL,
  `stated_status` varchar(16) NULL,
  `summary` varchar(300) NOT NULL,
  `occurred_at` timestamp NOT NULL,
  `occurred_until` timestamp NULL,
  `time_precision` varchar(8) NOT NULL,
  `discovered_at` timestamp NOT NULL,
  `evidence_id` varchar(36) NOT NULL,
  `basis` varchar(16) NOT NULL,
  `conflicts_with_json` json NULL,
  `run_id` varchar(36) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bk_timeline_entity` (`journey_id`, `entity_id`, `occurred_at`),
  KEY `idx_bk_timeline_tenant` (`tenant_id`, `journey_id`)
);
CREATE TABLE IF NOT EXISTS `business_knowledge_assertions` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NULL,
  `claim_key` varchar(191) NOT NULL,
  `subject_entity_id` varchar(36) NOT NULL,
  `predicate` varchar(16) NOT NULL,
  `object_entity_id` varchar(36) NULL,
  `value` varchar(48) NOT NULL,
  `detail` varchar(1000) NULL,
  `effective_from` timestamp NULL,
  `effective_to` timestamp NULL,
  `basis` varchar(16) NOT NULL,
  `confidence` int NOT NULL,
  `rationale` varchar(600) NOT NULL,
  `evidence_ids_json` json NOT NULL,
  `authorizes_financial_merge` tinyint(1) NOT NULL DEFAULT 0,
  `state` varchar(16) NOT NULL,
  `version` int NOT NULL,
  `supersedes_id` varchar(36) NULL,
  `superseded_by_id` varchar(36) NULL,
  `superseded_at` timestamp NULL,
  `created_by` varchar(24) NOT NULL,
  `question_id` varchar(36) NULL,
  `created_at` timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `idx_bk_assertions_claim` (`journey_id`, `claim_key`, `state`),
  KEY `idx_bk_assertions_subject` (`journey_id`, `subject_entity_id`),
  KEY `idx_bk_assertions_tenant` (`tenant_id`, `journey_id`)
);
CREATE TABLE IF NOT EXISTS `business_knowledge_questions` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NULL,
  `topic_key` varchar(191) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `entity_ids_json` json NOT NULL,
  `question` varchar(500) NOT NULL,
  `why` varchar(500) NOT NULL,
  `priority` int NOT NULL,
  `status` varchar(16) NOT NULL,
  `evidence_fingerprint` varchar(64) NOT NULL,
  `asked_at` timestamp NULL,
  `answer_text` varchar(1000) NULL,
  `answered_at` timestamp NULL,
  `follow_up` varchar(500) NULL,
  `follow_up_answer` varchar(1000) NULL,
  `resolution_json` json NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bk_questions_topic` (`journey_id`, `topic_key`),
  KEY `idx_bk_questions_tenant` (`tenant_id`, `journey_id`)
);
CREATE TABLE IF NOT EXISTS `business_knowledge_runs` (
  `id` varchar(36) NOT NULL,
  `journey_id` varchar(36) NOT NULL,
  `tenant_id` varchar(64) NULL,
  `kind` varchar(16) NOT NULL,
  `status` varchar(24) NOT NULL,
  `running_key` varchar(16) NULL,
  `model` varchar(64) NULL,
  `trigger_reason` varchar(200) NULL,
  `started_at` timestamp NOT NULL,
  `finished_at` timestamp NULL,
  `lease_until` timestamp NULL,
  `watermark_at` timestamp NULL,
  `budget_json` json NULL,
  `used_json` json NULL,
  `coverage_json` json NULL,
  `research_json` json NULL,
  `notes_json` json NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_bk_runs_running` (`journey_id`, `running_key`),
  KEY `idx_bk_runs_journey` (`journey_id`, `started_at`),
  KEY `idx_bk_runs_tenant` (`tenant_id`, `journey_id`)
);
