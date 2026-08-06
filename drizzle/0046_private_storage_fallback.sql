CREATE TABLE IF NOT EXISTS `private_storage_objects` (
  `storageKey` varchar(512) NOT NULL,
  `contentType` varchar(191) NOT NULL,
  `data` longblob NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `private_storage_objects_storageKey` PRIMARY KEY (`storageKey`)
);
