ALTER TABLE `cleancloud_import_batches`
  ADD COLUMN `tenantId` varchar(64) NOT NULL DEFAULT 'default' AFTER `id`;

ALTER TABLE `cleancloud_paid_orders`
  DROP INDEX `uq_cleancloud_paid_order_report`,
  ADD CONSTRAINT `uq_cleancloud_paid_order_report` UNIQUE (`tenantId`,`cleancloudOrderId`,`sourceReportType`);

CREATE TABLE `dayforge_saas_tenants` (
  `id` varchar(64) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `businessName` varchar(255) NOT NULL,
  `brandName` varchar(255) NOT NULL,
  `logoUrl` varchar(1024) NULL,
  `primaryColor` varchar(16) NOT NULL,
  `contactName` varchar(255) NOT NULL,
  `contactEmail` varchar(320) NOT NULL,
  `contactPhone` varchar(64) NULL,
  `website` varchar(512) NULL,
  `timeZone` varchar(64) NOT NULL,
  `proposalTemplateKey` varchar(128) NULL,
  `status` enum('provisioning','configuring','active','delinquent','suspended','canceled') NOT NULL DEFAULT 'provisioning',
  `onboardingStep` varchar(64) NOT NULL DEFAULT 'business',
  `onboardingCompletedAt` timestamp NULL,
  `billingStateUpdatedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_tenants_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_tenants_slug` UNIQUE (`slug`)
);

CREATE TABLE `dayforge_saas_tenant_locations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `locationKey` varchar(64) NOT NULL,
  `label` varchar(128) NOT NULL,
  `address` varchar(512) NOT NULL,
  `latitude` decimal(10,7) NULL,
  `longitude` decimal(10,7) NULL,
  `serviceRadiusMiles` decimal(6,2) NOT NULL,
  `maxPoundsPerDay` int NOT NULL,
  `maxPoundsByWeekdayJson` json NOT NULL,
  `openCapacityPoundsPerWeek` int NOT NULL,
  `pickupDaysJson` json NOT NULL,
  `routeWindowsJson` json NOT NULL,
  `turnaroundHours` int NOT NULL,
  `deliveryEnabled` boolean NOT NULL DEFAULT true,
  `isPrimary` boolean NOT NULL DEFAULT false,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_tenant_locations_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_locations_key` UNIQUE (`tenantId`,`locationKey`),
  INDEX `idx_dayforge_saas_locations_tenant` (`tenantId`,`isPrimary`)
);

CREATE TABLE `dayforge_saas_tenant_domains` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `hostname` varchar(255) NOT NULL,
  `verifiedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `dayforge_saas_tenant_domains_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_tenant_domain` UNIQUE (`hostname`),
  INDEX `idx_dayforge_saas_tenant_domains_tenant` (`tenantId`)
);

CREATE TABLE `dayforge_saas_tenant_services` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `locationId` int NOT NULL DEFAULT 0,
  `serviceKey` varchar(96) NOT NULL,
  `name` varchar(255) NOT NULL,
  `enabled` boolean NOT NULL DEFAULT true,
  `commercialEnabled` boolean NOT NULL DEFAULT false,
  `pricePerPoundCents` int NULL,
  `minimumOrderCents` int NULL,
  `terms` text NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_tenant_services_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_services_key` UNIQUE (`tenantId`,`locationId`,`serviceKey`)
);

CREATE TABLE `dayforge_saas_memberships` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `userOpenId` varchar(64) NOT NULL,
  `role` enum('owner','admin','operator','field') NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_memberships_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_membership_user` UNIQUE (`tenantId`,`userOpenId`),
  INDEX `idx_dayforge_saas_memberships_tenant_role` (`tenantId`,`role`,`active`)
);

CREATE TABLE `dayforge_saas_tenant_invites` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `emailNormalized` varchar(320) NOT NULL,
  `role` enum('owner','admin','operator','field') NOT NULL,
  `tokenHash` varchar(64) NOT NULL,
  `status` enum('pending','accepted','revoked','expired') NOT NULL DEFAULT 'pending',
  `invitedByOpenId` varchar(64) NULL,
  `expiresAt` timestamp NOT NULL,
  `acceptedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_tenant_invites_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_invite_token` UNIQUE (`tokenHash`),
  INDEX `idx_dayforge_saas_invites_tenant_email` (`tenantId`,`emailNormalized`,`status`)
);

CREATE TABLE `dayforge_saas_user_credentials` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `userOpenId` varchar(64) NOT NULL,
  `emailNormalized` varchar(320) NOT NULL,
  `passwordHash` varchar(255) NOT NULL,
  `failedLoginCount` int NOT NULL DEFAULT 0,
  `lockedUntil` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_user_credentials_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_credentials_tenant_email` UNIQUE (`tenantId`,`emailNormalized`),
  CONSTRAINT `uq_dayforge_saas_credentials_open_id` UNIQUE (`userOpenId`)
);

CREATE TABLE `dayforge_saas_onboarding_sessions` (
  `id` varchar(36) NOT NULL,
  `resumeTokenHash` varchar(64) NOT NULL,
  `businessName` varchar(255) NOT NULL,
  `slug` varchar(64) NOT NULL,
  `ownerEmail` varchar(320) NOT NULL,
  `currentStep` varchar(64) NOT NULL DEFAULT 'business',
  `version` int NOT NULL DEFAULT 1,
  `configurationJson` json NULL,
  `status` enum('draft','checkout_pending','provisioned','configuring','complete','expired') NOT NULL DEFAULT 'draft',
  `tenantId` varchar(64) NULL,
  `planKey` varchar(96) NULL,
  `stripeCheckoutSessionId` varchar(255) NULL,
  `stripeCustomerId` varchar(255) NULL,
  `stripeSubscriptionId` varchar(255) NULL,
  `startRequestId` varchar(36) NOT NULL,
  `checkoutRequestId` varchar(36) NULL,
  `expiresAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_onboarding_sessions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_onboarding_token` UNIQUE (`resumeTokenHash`),
  CONSTRAINT `uq_dayforge_saas_onboarding_start_request` UNIQUE (`startRequestId`),
  CONSTRAINT `uq_dayforge_saas_onboarding_checkout` UNIQUE (`stripeCheckoutSessionId`),
  CONSTRAINT `uq_dayforge_saas_onboarding_subscription` UNIQUE (`stripeSubscriptionId`),
  INDEX `idx_dayforge_saas_onboarding_email` (`ownerEmail`,`createdAt`)
);

CREATE TABLE `dayforge_saas_billing_plans` (
  `planKey` varchar(96) NOT NULL,
  `displayName` varchar(255) NOT NULL,
  `stripePriceId` varchar(255) NOT NULL,
  `stripeProductId` varchar(255) NULL,
  `trialDays` int NOT NULL DEFAULT 0,
  `foundingPlan` boolean NOT NULL DEFAULT false,
  `availabilityStartsAt` timestamp NULL,
  `availabilityEndsAt` timestamp NULL,
  `maxSubscriptions` int NULL,
  `claimedSubscriptions` int NOT NULL DEFAULT 0,
  `rulesJson` json NOT NULL,
  `entitlementsJson` json NOT NULL,
  `active` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_billing_plans_planKey` PRIMARY KEY (`planKey`),
  CONSTRAINT `uq_dayforge_saas_billing_price` UNIQUE (`stripePriceId`)
);

CREATE TABLE `dayforge_saas_checkout_sessions` (
  `id` varchar(36) NOT NULL,
  `onboardingSessionId` varchar(36) NOT NULL,
  `planKey` varchar(96) NOT NULL,
  `requestId` varchar(36) NOT NULL,
  `stripeCheckoutSessionId` varchar(255) NULL,
  `status` enum('reserved','open','completed','expired') NOT NULL DEFAULT 'reserved',
  `claimedSlot` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_checkout_sessions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_checkout_onboarding` UNIQUE (`onboardingSessionId`),
  CONSTRAINT `uq_dayforge_checkout_request` UNIQUE (`requestId`),
  CONSTRAINT `uq_dayforge_checkout_stripe` UNIQUE (`stripeCheckoutSessionId`)
);

CREATE TABLE `dayforge_saas_subscriptions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `planKey` varchar(96) NOT NULL,
  `stripeCustomerId` varchar(255) NOT NULL,
  `stripeSubscriptionId` varchar(255) NOT NULL,
  `status` enum('none','trialing','active','past_due','unpaid','paused','incomplete','incomplete_expired','canceled') NOT NULL,
  `cancelAtPeriodEnd` boolean NOT NULL DEFAULT false,
  `currentPeriodEnd` timestamp NULL,
  `trialEnd` timestamp NULL,
  `graceEndsAt` timestamp NULL,
  `accessEndsAt` timestamp NULL,
  `delinquentAt` timestamp NULL,
  `lastInvoicePaidAt` timestamp NULL,
  `latestInvoiceId` varchar(255) NULL,
  `lastStripeEventId` varchar(255) NOT NULL,
  `lastStripeEventCreatedAt` timestamp NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_subscriptions_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_subscriptions_tenant` UNIQUE (`tenantId`),
  CONSTRAINT `uq_dayforge_saas_subscriptions_stripe` UNIQUE (`stripeSubscriptionId`),
  INDEX `idx_dayforge_saas_subscriptions_customer` (`stripeCustomerId`)
);

CREATE TABLE `dayforge_saas_entitlements` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `entitlementKey` varchar(96) NOT NULL,
  `source` enum('plan','manual') NOT NULL DEFAULT 'plan',
  `enabled` boolean NOT NULL DEFAULT false,
  `expiresAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_entitlements_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_entitlement` UNIQUE (`tenantId`,`entitlementKey`,`source`)
);

CREATE TABLE `dayforge_saas_billing_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `stripeEventId` varchar(255) NOT NULL,
  `eventType` varchar(128) NOT NULL,
  `livemode` boolean NOT NULL DEFAULT false,
  `stripeCreatedAt` timestamp NOT NULL,
  `payloadHash` varchar(64) NOT NULL,
  `tenantId` varchar(64) NULL,
  `objectId` varchar(255) NULL,
  `status` enum('processing','processed','ignored','failed') NOT NULL DEFAULT 'processing',
  `errorCode` varchar(128) NULL,
  `metadataJson` json NULL,
  `processingStartedAt` timestamp NOT NULL DEFAULT (now()),
  `attemptCount` int NOT NULL DEFAULT 1,
  `processedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `dayforge_saas_billing_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_billing_event` UNIQUE (`stripeEventId`)
);

CREATE TABLE `dayforge_audit_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `scopeKey` varchar(191) NOT NULL,
  `tenantId` varchar(64) NULL,
  `actorType` enum('public','owner','admin','operator','field','stripe','system') NOT NULL,
  `actorId` varchar(128) NULL,
  `entityType` varchar(96) NOT NULL,
  `entityId` varchar(128) NOT NULL,
  `eventName` varchar(96) NOT NULL,
  `beforeJson` json NULL,
  `afterJson` json NULL,
  `source` varchar(96) NOT NULL,
  `correlationId` varchar(191) NOT NULL,
  `idempotencyKey` varchar(191) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `dayforge_audit_events_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_audit_idempotency` UNIQUE (`scopeKey`,`idempotencyKey`),
  INDEX `idx_dayforge_audit_tenant_entity` (`tenantId`,`entityType`,`entityId`,`createdAt`)
);

CREATE TABLE `dayforge_saas_import_connections` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `providerKey` varchar(96) NOT NULL,
  `status` enum('configured','connected','error','disabled') NOT NULL DEFAULT 'configured',
  `credentialReference` varchar(255) NULL,
  `configurationJson` json NOT NULL,
  `lastImportedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_import_connections_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_saas_import_connection` UNIQUE (`tenantId`,`providerKey`)
);

CREATE TABLE `dayforge_saas_import_runs` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `connectionId` int NOT NULL,
  `status` enum('started','completed','completed_with_errors','failed') NOT NULL,
  `sourceCursor` varchar(512) NULL,
  `importedCustomers` int NOT NULL DEFAULT 0,
  `importedOrders` int NOT NULL DEFAULT 0,
  `skippedRecords` int NOT NULL DEFAULT 0,
  `errorJson` json NULL,
  `startedAt` timestamp NOT NULL DEFAULT (now()),
  `completedAt` timestamp NULL,
  CONSTRAINT `dayforge_saas_import_runs_id` PRIMARY KEY (`id`),
  INDEX `idx_dayforge_saas_import_runs_tenant` (`tenantId`,`startedAt`)
);

CREATE TABLE `dayforge_saas_external_customers` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `connectionId` int NOT NULL,
  `providerKey` varchar(96) NOT NULL,
  `externalId` varchar(191) NOT NULL,
  `name` varchar(255) NOT NULL,
  `email` varchar(320) NULL,
  `phone` varchar(64) NULL,
  `factsJson` json NOT NULL,
  `sourceCapturedAt` timestamp NOT NULL,
  `importRunId` varchar(36) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_external_customers_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_external_customer` UNIQUE (`tenantId`,`connectionId`,`externalId`)
);

CREATE TABLE `dayforge_saas_external_orders` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL,
  `connectionId` int NOT NULL,
  `providerKey` varchar(96) NOT NULL,
  `externalId` varchar(191) NOT NULL,
  `externalCustomerId` varchar(191) NULL,
  `totalCents` int NOT NULL,
  `paid` boolean NOT NULL DEFAULT false,
  `occurredAt` timestamp NULL,
  `factsJson` json NOT NULL,
  `sourceCapturedAt` timestamp NOT NULL,
  `importRunId` varchar(36) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `dayforge_saas_external_orders_id` PRIMARY KEY (`id`),
  CONSTRAINT `uq_dayforge_external_order` UNIQUE (`tenantId`,`connectionId`,`externalId`),
  INDEX `idx_dayforge_external_orders_tenant_occurred` (`tenantId`,`occurredAt`)
);
