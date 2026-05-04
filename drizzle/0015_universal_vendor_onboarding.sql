CREATE TABLE `vendor_profiles` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int NOT NULL,
  `businessName` varchar(255) NOT NULL,
  `vendorCategory` varchar(100) NOT NULL,
  `contactName` varchar(255),
  `phone` varchar(30),
  `email` varchar(320),
  `serviceModel` enum('mobile','fixed_location','both') NOT NULL DEFAULT 'mobile',
  `buildingNativeServiceAvailable` boolean NOT NULL DEFAULT true,
  `serviceAreaJson` json,
  `buildingsJson` json,
  `trafficProtectionMode` enum('back_to_back','breathing_room','geo_clustered') NOT NULL DEFAULT 'geo_clustered',
  `resetTimeMinutes` int NOT NULL DEFAULT 15,
  `geoClusteringEnabled` boolean NOT NULL DEFAULT true,
  `bookingLeadTimeHours` int NOT NULL DEFAULT 24,
  `providerResponseTimeoutMinutes` int NOT NULL DEFAULT 120,
  `calendarConnectionStatus` varchar(64) NOT NULL DEFAULT 'not_connected',
  `payoutSetupStatus` varchar(64) NOT NULL DEFAULT 'not_started',
  `onboardingStatus` enum('started','collecting_details','pricing_setup','availability_setup','payment_setup','admin_configured','completed','abandoned') NOT NULL DEFAULT 'started',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_profiles_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_services` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int NOT NULL,
  `serviceName` varchar(255) NOT NULL,
  `serviceCategory` varchar(100) NOT NULL,
  `description` text,
  `basePriceCents` int NOT NULL,
  `recommendedPriceCents` int,
  `durationMinutes` int NOT NULL,
  `isMobile` boolean NOT NULL DEFAULT true,
  `isBuildingNative` boolean NOT NULL DEFAULT true,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_services_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_availability_windows` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int NOT NULL,
  `dayOfWeek` int NOT NULL,
  `startTime` varchar(10) NOT NULL,
  `endTime` varchar(10) NOT NULL,
  `timezone` varchar(64) NOT NULL DEFAULT 'America/Los_Angeles',
  `buildingScopeJson` json,
  `neighborhoodScopeJson` json,
  `isActive` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_availability_windows_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_admin_configs` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int NOT NULL,
  `categoryPresetKey` varchar(100) NOT NULL,
  `themeKey` enum('clinical_minimalist','pixel_operations','standard') NOT NULL DEFAULT 'standard',
  `enabledSurfacesJson` json,
  `navConfigJson` json,
  `brandConfigJson` json,
  `externalBookingBrandMode` varchar(64) NOT NULL DEFAULT 'vendor_primary',
  `publicBookingSlug` varchar(128) NOT NULL,
  `customDomain` varchar(255),
  `customDomainStatus` varchar(64) NOT NULL DEFAULT 'not_configured',
  `brandName` varchar(255),
  `brandLogoUrl` varchar(512),
  `brandAccentColor` varchar(32),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_admin_configs_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_peer_service_requests` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `requestingVendorId` int NOT NULL,
  `providerVendorId` int,
  `serviceCategory` varchar(100) NOT NULL,
  `serviceRequested` text NOT NULL,
  `buildingName` varchar(255),
  `locationDetailsJson` json,
  `preferredWindowStart` timestamp,
  `preferredWindowEnd` timestamp,
  `recommendedPriceCents` int,
  `status` enum('request_pending_provider_confirmation','accepted','declined','expired','cancelled','completed') NOT NULL DEFAULT 'request_pending_provider_confirmation',
  `responseTimeoutMinutes` int NOT NULL DEFAULT 120,
  `expiresAt` timestamp,
  `expiredAt` timestamp,
  `timeoutReason` varchar(255),
  `replacementOptionsJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_peer_service_requests_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_pricing_recommendations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int NOT NULL,
  `serviceId` int,
  `basePriceCents` int NOT NULL,
  `recommendedPriceCents` int NOT NULL,
  `conveniencePremiumPercent` int NOT NULL DEFAULT 10,
  `travelTimeMinutesAssumed` int NOT NULL DEFAULT 20,
  `estimatedBookingsPerDay` int NOT NULL DEFAULT 4,
  `comparablePricingJson` json,
  `reasoning` text NOT NULL,
  `status` enum('draft','accepted','rejected') NOT NULL DEFAULT 'draft',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `acceptedAt` timestamp,
  `rejectedAt` timestamp,
  CONSTRAINT `vendor_pricing_recommendations_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_data_exports` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int NOT NULL,
  `exportType` enum('clients','bookings','services') NOT NULL,
  `exportUrl` text NOT NULL,
  `requestedByUserId` varchar(128),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `vendor_data_exports_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_guest_booking_sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int NOT NULL,
  `phone` varchar(30),
  `otpVerified` boolean NOT NULL DEFAULT false,
  `trustedDeviceHash` varchar(255),
  `serviceId` int,
  `requestedWindowJson` json,
  `status` varchar(64) NOT NULL DEFAULT 'started',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_guest_booking_sessions_id` PRIMARY KEY(`id`)
);

CREATE TABLE `vendor_onboarding_sessions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `vendorId` int,
  `sessionId` varchar(128) NOT NULL,
  `conversationId` varchar(128),
  `vendorCategory` varchar(100),
  `status` enum('started','collecting_details','pricing_setup','availability_setup','payment_setup','admin_configured','completed','abandoned') NOT NULL DEFAULT 'started',
  `lastCompletedStep` varchar(128),
  `missingFieldsJson` json,
  `abandoned2hLoggedAt` timestamp,
  `abandoned24hLoggedAt` timestamp,
  `abandoned7dLoggedAt` timestamp,
  `abandonedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_onboarding_sessions_id` PRIMARY KEY(`id`)
);
