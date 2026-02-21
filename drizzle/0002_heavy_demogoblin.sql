ALTER TABLE `orders` MODIFY COLUMN `status` enum('new','collected','processing','ready','delivered') NOT NULL DEFAULT 'new';--> statement-breakpoint
ALTER TABLE `orders` ADD `deliveryDate` varchar(20);--> statement-breakpoint
ALTER TABLE `orders` ADD `deliveryTimeWindow` varchar(50);--> statement-breakpoint
ALTER TABLE `orders` ADD `stripePaymentIntentId` varchar(255);--> statement-breakpoint
ALTER TABLE `orders` ADD `weightLbs` decimal(8,2);--> statement-breakpoint
ALTER TABLE `orders` ADD `bagCount` int DEFAULT 1;--> statement-breakpoint
ALTER TABLE `orders` ADD `garmentCount` int;--> statement-breakpoint
ALTER TABLE `orders` ADD `subtotal` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `orders` ADD `discountPercent` decimal(5,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `orders` ADD `total` decimal(10,2) DEFAULT '0';--> statement-breakpoint
ALTER TABLE `orders` ADD `upchargesJson` json;--> statement-breakpoint
ALTER TABLE `orders` ADD `drycleanItemsJson` json;--> statement-breakpoint
ALTER TABLE `orders` ADD `paid` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `isFirstPaidOrder` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `portalJwt` text;