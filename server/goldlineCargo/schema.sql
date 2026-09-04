CREATE TABLE IF NOT EXISTS goldline_vehicle_custody (
 tenantId varchar(64) NOT NULL, orderId int NOT NULL, revision int NOT NULL DEFAULT 1,
 state enum('IN_VEHICLE_UNPROCESSED','AT_PROCESSOR','IN_VEHICLE_PROCESSED') NOT NULL,
 vehicleId varchar(128) NULL, actorId varchar(128) NOT NULL, evidenceJson json NOT NULL,
 transferredAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenantId,orderId), KEY idx_goldline_custody_vehicle (tenantId,vehicleId,state)
);
