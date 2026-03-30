CREATE TABLE `catalog_items` (
  `id` int AUTO_INCREMENT NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',
  `slug` varchar(128) NOT NULL,
  `name` varchar(255) NOT NULL,
  `category` varchar(100) NOT NULL,
  `standardPriceCents` int NOT NULL,
  `expressPriceCents` int,
  `costCents` int NOT NULL DEFAULT 0,
  `isActive` boolean NOT NULL DEFAULT true,
  `isOnline` boolean NOT NULL DEFAULT false,
  `archived` boolean NOT NULL DEFAULT false,
  `sortOrder` int NOT NULL DEFAULT 0,
  `iconUrl` varchar(512),
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `catalog_items_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_catalog_items_tenant_slug` UNIQUE(`tenantId`,`slug`)
);
