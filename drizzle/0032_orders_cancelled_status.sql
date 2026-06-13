ALTER TABLE `orders` MODIFY COLUMN `status` enum('new','intake-pending','collected','processing','ready','delivered','cancelled') NOT NULL DEFAULT 'new';
