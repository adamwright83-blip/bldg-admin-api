-- Parking-lot debrief: bind each raw field journal to the real commercial visit it debriefs.
-- Existing general journals remain valid with NULL debriefMissionId.

ALTER TABLE `driver_sales_journals`
  ADD COLUMN `debriefMissionId` int NULL AFTER `clientRequestId`,
  ADD KEY `idx_driver_sales_journal_tenant_mission` (`tenantId`, `debriefMissionId`, `createdAt`);
