CREATE TABLE `leads` (
  `id` int AUTO_INCREMENT NOT NULL,
  `name` varchar(255) NOT NULL,
  `building_name` varchar(255) NOT NULL,
  `role` varchar(100),
  `email` varchar(320) NOT NULL,
  `number_of_units` varchar(50),
  `phone` varchar(30),
  `source` varchar(100) DEFAULT 'add_your_building_form',
  `source_url` varchar(512),
  `status` enum('New','Contacted','Qualified','Closed','Spam') NOT NULL DEFAULT 'New',
  `is_read` boolean NOT NULL DEFAULT false,
  `notes` text,
  `assigned_to` varchar(255),
  `submitted_at` timestamp NOT NULL DEFAULT (now()),
  `created_at` timestamp NOT NULL DEFAULT (now()),
  `updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
