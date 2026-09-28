-- CleanCloud churn observations.
-- Native lastOrderId and customerPhone stay. They are no longer required,
-- because a CleanCloud customer may have no numeric order id and no phone.
-- No backfill. Do not invent order ids or phone numbers.

ALTER TABLE `customer_churn_snapshots`
  MODIFY COLUMN `lastOrderId` int NULL,
  MODIFY COLUMN `customerPhone` varchar(30) NULL,
  ADD COLUMN `externalOrderRef` varchar(128) NULL,
  ADD COLUMN `orderSource` varchar(32) NOT NULL DEFAULT 'native';
