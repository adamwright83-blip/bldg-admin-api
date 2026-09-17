CREATE TABLE IF NOT EXISTS goldline_onboarding_sessions (
 tenantId varchar(64) NOT NULL PRIMARY KEY,
 id varchar(36) NOT NULL,
 version int NOT NULL DEFAULT 0,
 payload json NOT NULL,
 updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
