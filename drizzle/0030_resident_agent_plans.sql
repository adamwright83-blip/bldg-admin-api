CREATE TABLE `resident_agent_plans` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `bldgUserId` int,
  `residentName` varchar(255),
  `buildingSlug` varchar(100),
  `buildingName` varchar(255),
  `unit` varchar(50),
  `conversationId` varchar(128),
  `sessionId` varchar(128),
  `originalMessage` text NOT NULL,
  `planStatus` enum('partially_confirmed','pending_confirmation','completed','failed','cancelled') NOT NULL DEFAULT 'pending_confirmation',
  `planJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `resident_agent_plans_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_resident_agent_plans_tenant_status` ON `resident_agent_plans` (`tenantId`,`planStatus`);
CREATE INDEX `idx_resident_agent_plans_tenant_user` ON `resident_agent_plans` (`tenantId`,`bldgUserId`);
CREATE INDEX `idx_resident_agent_plans_conversation` ON `resident_agent_plans` (`conversationId`);

CREATE TABLE `resident_coordinated_requests` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `bldgUserId` int,
  `residentName` varchar(255),
  `residentPhone` varchar(30),
  `residentEmail` varchar(320),
  `buildingSlug` varchar(100),
  `buildingName` varchar(255),
  `unit` varchar(50),
  `serviceCategory` enum('dog_grooming','car_detail','airport_transport','apartment_cleaning','dry_cleaning','other') NOT NULL,
  `serviceRequested` text NOT NULL,
  `requestedDate` varchar(20),
  `requestedWindow` varchar(100),
  `deadlineDate` varchar(20),
  `deadlineReason` text,
  `origin` varchar(255),
  `destination` varchar(255),
  `notes` text,
  `status` enum('pending_operator_review','pending_provider_confirmation','confirmed','declined','cancelled','completed','failed') NOT NULL DEFAULT 'pending_operator_review',
  `statusReason` text,
  `residentVisibleStatus` enum('confirmed','pending_provider_confirmation','pending_operator_review','failed','cancelled','completed') NOT NULL DEFAULT 'pending_operator_review',
  `nextAction` text,
  `requiresHumanApproval` boolean NOT NULL DEFAULT true,
  `customerCharged` boolean NOT NULL DEFAULT false,
  `providerVendorId` int,
  `providerConfirmationStatus` varchar(100),
  `sourceConversationId` varchar(128),
  `sourceSessionId` varchar(128),
  `parentPlanId` int,
  `rawJson` json,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `resident_coordinated_requests_id` PRIMARY KEY(`id`)
);

CREATE INDEX `idx_resident_coord_requests_tenant_status` ON `resident_coordinated_requests` (`tenantId`,`status`);
CREATE INDEX `idx_resident_coord_requests_tenant_plan` ON `resident_coordinated_requests` (`tenantId`,`parentPlanId`);
CREATE INDEX `idx_resident_coord_requests_tenant_user` ON `resident_coordinated_requests` (`tenantId`,`bldgUserId`);
CREATE INDEX `idx_resident_coord_requests_category` ON `resident_coordinated_requests` (`serviceCategory`);
