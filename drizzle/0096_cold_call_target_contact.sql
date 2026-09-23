-- Pin each Cold Call target to the commercial contact it was created from,
-- and give a roll a compare-and-swap claim so two concurrent starts cannot
-- both dial. contactId is backfilled from the existing sourceReference.
-- A sibling contact on the same mission is not a substitute.

ALTER TABLE `driver_cold_call_targets`
  ADD COLUMN `contactId` int NULL,
  ADD COLUMN `rollClaimId` varchar(36) NULL;

UPDATE `driver_cold_call_targets`
SET `contactId` = CAST(SUBSTRING_INDEX(`sourceReference`, ':', -1) AS UNSIGNED)
WHERE `contactId` IS NULL
  AND `sourceReference` LIKE 'commercial_account_contacts:%';

CREATE INDEX `idx_driver_cold_call_target_contact`
  ON `driver_cold_call_targets` (`tenantId`, `contactId`);
