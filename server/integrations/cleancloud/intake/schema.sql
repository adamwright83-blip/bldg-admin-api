CREATE TABLE IF NOT EXISTS cleancloud_intake_connections (
 tenantId varchar(64) PRIMARY KEY, bindingId varchar(36) NOT NULL, actorId varchar(128) NOT NULL,
 enabled boolean NOT NULL DEFAULT false, catalogJson json NOT NULL, capturedAt timestamp NULL
);
CREATE TABLE IF NOT EXISTS cleancloud_intake_orders (
 id varchar(36) PRIMARY KEY, tenantId varchar(64) NOT NULL, bindingId varchar(36) NOT NULL,
 externalOrderId varchar(191) NOT NULL, sourceJson json NOT NULL, sourcePresent boolean NOT NULL DEFAULT true,
 state varchar(24) NOT NULL DEFAULT 'detail', revision varchar(36) NULL, planJson json NULL, preparedJson json NULL,
 preparedAt timestamp NULL, approvedAt timestamp NULL, submittedAt timestamp NULL, resultJson json NULL,
 leaseToken varchar(36) NULL, leaseUntil timestamp NULL, operation varchar(16) NULL,
 focusRequested boolean NOT NULL DEFAULT false, lastError varchar(512) NULL, observedAt timestamp NOT NULL,
 UNIQUE KEY uq_cc_intake_source (tenantId,bindingId,externalOrderId), KEY idx_cc_intake_queue (tenantId,state,leaseUntil)
);
