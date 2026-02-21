CREATE TABLE `orders` (
	`id` int AUTO_INCREMENT NOT NULL,
	`serviceType` enum('wash_fold','dry_cleaning') NOT NULL,
	`pickupDate` varchar(20) NOT NULL,
	`pickupTimeWindow` varchar(50) NOT NULL,
	`address` text NOT NULL,
	`unit` varchar(50),
	`specialInstructions` text,
	`firstName` varchar(100) NOT NULL,
	`lastName` varchar(100) NOT NULL,
	`phone` varchar(30) NOT NULL,
	`email` varchar(320),
	`stripeCustomerId` varchar(255),
	`stripePaymentMethodId` varchar(255),
	`status` enum('pending','confirmed','picked_up','processing','delivered','cancelled') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `orders_id` PRIMARY KEY(`id`)
);
