-- President autonomous cycle store.
-- President-only durable state: deliberation, Adam approval receipt, missions, review receipts and morning handback.
-- No commercial/customer revenue tables are read or written here.
CREATE TABLE IF NOT EXISTS president_autonomous_cycles (
  cycleId varchar(64) PRIMARY KEY,
  tenantId varchar(191) NOT NULL,
  version int NOT NULL,
  status varchar(64) NOT NULL,
  payloadJson json NOT NULL,
  createdAt datetime(3) NOT NULL,
  updatedAt datetime(3) NOT NULL,
  KEY idx_president_autonomous_cycles_tenant (tenantId,updatedAt),
  KEY idx_president_autonomous_cycles_status (status,updatedAt)
);
