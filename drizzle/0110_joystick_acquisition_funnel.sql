-- LEGACY DAYFORGE COMPATIBILITY: retained historical SaaS table literal only; canonical product is JOYSTICK.
-- JOYSTICK acquisition funnel: evolve the existing SaaS onboarding spine.
-- No parallel acquisition table. Existing rows remain legacy_laundry.

ALTER TABLE dayforge_saas_onboarding_sessions
  MODIFY COLUMN businessName varchar(255) NULL,
  MODIFY COLUMN slug varchar(64) NULL,
  MODIFY COLUMN ownerEmail varchar(320) NULL,
  ADD COLUMN onboardingMode varchar(32) NOT NULL DEFAULT 'legacy_laundry' AFTER ownerEmail,
  ADD COLUMN draftAnswersJson json NULL AFTER onboardingMode,
  ADD COLUMN draftPreviewJson json NULL AFTER draftAnswersJson;
