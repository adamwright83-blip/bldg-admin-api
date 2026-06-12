-- Resident-laundry idempotency: DB-enforced exact-once create.
-- Adds a nullable physical key column + UNIQUE index so the same resident
-- "set it in motion" tap can create at most one order, even under concurrent
-- retries (the unique index is the atomic guard; a failed insert is caught and
-- the existing order id is returned). Nullable + MySQL's multi-NULL-allowed
-- unique semantics mean existing rows and keyless (non-resident) rows are safe
-- with no backfill.
ALTER TABLE `orders` ADD COLUMN `residentClientRequestId` varchar(191);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_resident_client_request_id_unq` ON `orders` (`residentClientRequestId`);
