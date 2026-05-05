ALTER TABLE `vendor_admin_configs`
  ADD COLUMN `templateKey` varchar(128) NOT NULL DEFAULT 'vendor_booking_template_01',
  ADD COLUMN `publicBookingStatus` enum('draft','published','unpublished') NOT NULL DEFAULT 'draft',
  ADD COLUMN `templateContentJson` json,
  ADD COLUMN `publishedAt` timestamp,
  ADD COLUMN `approvedByUserId` varchar(128);
