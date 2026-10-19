-- LEGACY DAYFORGE COMPATIBILITY: retained historical literal only; not current architecture. Canonical product is JOYSTICK and today's work surface is Day Line. See docs/legacy/LEGACY_DAYFORGE_COMPATIBILITY.md.
-- Tenant registration for Laundry Farm.
-- Establishes Laundry Farm as an independent first-class SaaS tenant
-- while preserving Laundry Butler as tenant `default`.
-- Also establishes explicit operator memberships for `adam-admin` on both tenants.

INSERT INTO `dayforge_saas_tenants` (
  `id`, `slug`, `businessName`, `brandName`, `logoUrl`, `primaryColor`,
  `contactName`, `contactEmail`, `contactPhone`, `website`, `timeZone`,
  `status`, `onboardingStep`, `strategyVerticalKey`
) VALUES (
  'laundry_farm',
  'laundry-farm',
  'Laundry Farm',
  'Laundry Farm',
  'https://files.manuscdn.com/user_upload_by_module/session_file/310419663029845795/TnWYaeVttBiuZTNp.png',
  '#1B4D3E',
  'Adam Wright',
  'support@laundryfarm.com',
  '(424) 394-0344',
  'https://laundryfarm.com',
  'America/Los_Angeles',
  'active',
  'complete',
  'laundry_fluff_fold'
) ON DUPLICATE KEY UPDATE `businessName` = VALUES(`businessName`);

INSERT INTO `dayforge_saas_tenants` (
  `id`, `slug`, `businessName`, `brandName`, `logoUrl`, `primaryColor`,
  `contactName`, `contactEmail`, `contactPhone`, `website`, `timeZone`,
  `status`, `onboardingStep`, `strategyVerticalKey`
) VALUES (
  'default',
  'laundry-butler',
  'Laundry Butler',
  'Laundry Butler',
  NULL,
  '#2563EB',
  'Adam Wright',
  'adam@laundrybutler.com',
  '(310) 906-8968',
  'https://laundrybutler.com',
  'America/Los_Angeles',
  'active',
  'complete',
  'laundry_fluff_fold'
) ON DUPLICATE KEY UPDATE `businessName` = VALUES(`businessName`);

INSERT INTO `dayforge_saas_memberships` (
  `tenantId`, `userOpenId`, `role`, `active`
) VALUES (
  'laundry_farm', 'adam-admin', 'owner', 1
) ON DUPLICATE KEY UPDATE `role` = VALUES(`role`), `active` = 1;

INSERT INTO `dayforge_saas_memberships` (
  `tenantId`, `userOpenId`, `role`, `active`
) VALUES (
  'default', 'adam-admin', 'owner', 1
) ON DUPLICATE KEY UPDATE `role` = VALUES(`role`), `active` = 1;
