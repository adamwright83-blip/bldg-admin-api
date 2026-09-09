CREATE TABLE IF NOT EXISTS goldline_vehicle_custody (
 tenantId varchar(64) NOT NULL, orderId int NOT NULL, revision int NOT NULL DEFAULT 1,
 state enum('IN_VEHICLE_UNPROCESSED','AT_PROCESSOR','IN_VEHICLE_PROCESSED') NOT NULL,
 vehicleId varchar(128) NULL, actorId varchar(128) NOT NULL, evidenceJson json NOT NULL,
 transferredAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenantId,orderId), KEY idx_goldline_custody_vehicle (tenantId,vehicleId,state)
);
CREATE TABLE IF NOT EXISTS goldline_field_cargo (
 id varchar(36) NOT NULL, tenantId varchar(64) NOT NULL, vehicleId varchar(128) NULL,
 actorId varchar(128) NOT NULL, requestId varchar(64) NOT NULL, transcript text NOT NULL,
 customerDisplayName varchar(191) NOT NULL, itemDescription varchar(255) NOT NULL,
 quantity int NULL, serviceType enum('dry_cleaning','wash_fold') NULL,
 vehicleState enum('IN_VEHICLE','AT_PROCESSOR','REMOVED') NOT NULL DEFAULT 'IN_VEHICLE',
 processingState enum('unknown','unprocessed','processed') NOT NULL DEFAULT 'unknown',
 location varchar(512) NULL, notes text NULL, linkedOrderId int NULL,
 confirmedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 PRIMARY KEY (id), UNIQUE KEY uq_goldline_field_cargo_request (tenantId,requestId),
 KEY idx_goldline_field_cargo_vehicle (tenantId,vehicleId,vehicleState),
 KEY idx_goldline_field_cargo_order (tenantId,linkedOrderId)
);
