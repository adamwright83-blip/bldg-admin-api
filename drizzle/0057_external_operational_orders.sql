-- External operational orders — work that is REAL but did not originate in
-- Laundry Butler.
--
-- Deliberately NOT the `orders` table. That table carries Laundry Butler's own
-- lifecycle: Stripe customer/payment-intent ids, resident enrollment, vendor
-- routing and payout splits, platform fees, and the
-- new -> intake-pending -> collected -> processing -> ready -> delivered
-- progression that revenue, payment, notification and reconciliation code all
-- read. Putting a CleanCloud job in there would make it indistinguishable from
-- a native order to every one of those systems, which is exactly the kind of
-- convenience that quietly corrupts revenue truth later.
--
-- So: a small, honest record of externally-managed operational work. No money
-- fields. No Stripe. No vendor routing. No resident linkage. It can say what
-- the job is and where the physical work stands; it cannot say anything about
-- what was charged or who owns the customer relationship.
CREATE TABLE `external_operational_orders` (
  `id` varchar(36) NOT NULL,
  `tenantId` varchar(64) NOT NULL DEFAULT 'default',

  -- PROVENANCE. Which system actually owns this order, and how it got here.
  -- `ingestionMethod` is kept because a screenshot-extracted job and a job the
  -- operator typed by hand carry different confidence, and the review UI and
  -- any later audit should be able to tell them apart.
  `sourceSystem` enum('cleancloud','manual_external') NOT NULL,
  `ingestionMethod` enum('screenshot','manual','voice') NOT NULL,
  `externalOrderId` varchar(191) NULL,

  -- The job itself. Customer name and address are operational facts needed to
  -- physically do the work; nothing here implies a billing relationship.
  `jobKind` enum('pickup','dropoff') NOT NULL,
  `customerName` varchar(191) NOT NULL,
  `address` varchar(512) NULL,
  `scheduledDate` varchar(10) NULL,
  `windowStart` varchar(5) NULL,
  `windowEnd` varchar(5) NULL,
  `notes` text NULL,

  -- PHYSICAL truth: has the operator actually done the work.
  `operationalStatus` enum('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  `completedAt` timestamp NULL,

  -- EXTERNAL truth: has the owning system been told. Deliberately separate
  -- from operationalStatus, because doing the work and updating CleanCloud are
  -- two different events and conflating them would let the app imply it had
  -- updated a system it cannot even reach. `reconciled` means the OPERATOR
  -- confirmed they updated it — never that this app verified anything, which
  -- is why there is no `verified` member here.
  `reconciliationStatus` enum('update_required','reconciled') NOT NULL DEFAULT 'update_required',
  `reconciledAt` timestamp NULL,
  `externalLastVerifiedAt` timestamp NULL,

  -- Review gate. Nothing extracted from a screenshot becomes authoritative
  -- until a human confirms it, so rows land here as `pending_review` and only
  -- a confirmed row is eligible to become playable work.
  `reviewState` enum('pending_review','confirmed','discarded') NOT NULL DEFAULT 'pending_review',
  `importBatchId` varchar(36) NULL,
  `confirmedAt` timestamp NULL,

  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT `external_operational_orders_id` PRIMARY KEY (`id`),
  INDEX `idx_external_order_day` (`tenantId`, `scheduledDate`, `reviewState`),
  INDEX `idx_external_order_batch` (`importBatchId`),
  INDEX `idx_external_order_reconciliation` (`tenantId`, `reconciliationStatus`)
);
