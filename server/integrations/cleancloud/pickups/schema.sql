CREATE TABLE IF NOT EXISTS cleancloud_pickup_connections (
 tenantId varchar(64) PRIMARY KEY,
 bindingId varchar(36) NOT NULL,
 actorId varchar(128) NOT NULL,
 enabled boolean NOT NULL DEFAULT false,
 excludedOrderIds json NOT NULL,
 capturedAt timestamp NULL,
 lastError varchar(512) NULL
);
CREATE TABLE IF NOT EXISTS cleancloud_driver_pickups (
 id varchar(36) PRIMARY KEY,
 tenantId varchar(64) NOT NULL,
 bindingId varchar(36) NOT NULL,
 externalOrderId varchar(191) NOT NULL,
 externalOperationalOrderId varchar(36) NOT NULL,
 sourceJson json NOT NULL,
 state varchar(16) NOT NULL DEFAULT 'ready',
 bagCount int NULL,
 garmentCount int NULL,
 collectedBy varchar(128) NULL,
 collectedAt timestamp NULL,
 observedAt timestamp NOT NULL,
 leaseToken varchar(36) NULL,
 leaseUntil timestamp NULL,
 verifiedAt timestamp NULL,
 lastError varchar(512) NULL,
 UNIQUE KEY uq_cc_driver_pickup_source (tenantId,bindingId,externalOrderId),
 UNIQUE KEY uq_cc_driver_pickup_operational (externalOperationalOrderId),
 KEY idx_cc_driver_pickup_queue (tenantId,state,leaseUntil)
);
