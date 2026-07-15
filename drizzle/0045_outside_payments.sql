ALTER TABLE `orders`
  ADD COLUMN `paymentSource` enum('stripe','outside') NULL,
  ADD COLUMN `paymentMethod` varchar(32) NULL;

CREATE TABLE `customer_payments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `orderId` int NOT NULL,
  `source` enum('stripe','outside') NOT NULL,
  `method` enum('zelle','cash','check','other') NOT NULL,
  `amountCents` int NOT NULL,
  `receivedAt` timestamp NOT NULL,
  `referenceNote` text,
  `recordedBy` varchar(128) NOT NULL,
  `recordedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `customer_payments_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_customer_payments_order` UNIQUE(`orderId`)
);

CREATE TABLE `vendor_payments` (
  `id` int AUTO_INCREMENT NOT NULL,
  `orderId` int NOT NULL,
  `vendorId` int NOT NULL,
  `source` enum('stripe','outside') NOT NULL,
  `method` enum('zelle','cash','check','ach','other') NOT NULL,
  `amountCents` int NOT NULL,
  `paidAt` timestamp NOT NULL,
  `referenceNote` text,
  `recordedBy` varchar(128) NOT NULL,
  `recordedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `vendor_payments_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_vendor_payments_order` UNIQUE(`orderId`)
);

CREATE TABLE `payment_audit_events` (
  `id` int AUTO_INCREMENT NOT NULL,
  `orderId` int NOT NULL,
  `eventType` enum('outside_customer_payment_recorded','outside_vendor_payment_recorded') NOT NULL,
  `customerPaymentId` int,
  `vendorPaymentId` int,
  `actorId` varchar(128) NOT NULL,
  `detailsJson` json,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `payment_audit_events_id` PRIMARY KEY(`id`),
  CONSTRAINT `uq_payment_audit_order_event` UNIQUE(`orderId`,`eventType`)
);
