-- Tenant isolation: claire_proactive_obligations was keyed by `id` alone, but
-- obligation ids are unique only within a tenant (`recovery:<customer identity>`,
-- `sales:<account>:<date>`). Upserts use ON DUPLICATE KEY UPDATE, so a second
-- tenant writing the same id overwrote the first tenant's payload, status and
-- due date, and never got its own row.
--
-- The key becomes (tenantId, id). No row, column or id changes: existing ids
-- are already unique, so they stay unique per tenant, and every reference to an
-- obligation (Day Line idempotency keys `claire-proactive:<id>`, goal-cycle
-- selectedRef, operation receipts) is already read with its tenant.
-- scripts/migrate.mjs applies this only while the key is still `id` alone.
ALTER TABLE `claire_proactive_obligations`
  DROP PRIMARY KEY,
  ADD PRIMARY KEY (`tenantId`, `id`);
