CREATE TABLE IF NOT EXISTS sales_economic_decisions (
  tenantId VARCHAR(64) NOT NULL,
  keptEventKey VARCHAR(128) NOT NULL,
  otherEventKey VARCHAR(128) NOT NULL,
  decision ENUM('same_sale', 'distinct_sales') NOT NULL,
  evidenceReference VARCHAR(255) NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenantId, keptEventKey, otherEventKey)
);
CREATE TABLE IF NOT EXISTS sales_service_attribution (
  tenantId VARCHAR(64) NOT NULL,
  eventKey VARCHAR(128) NOT NULL,
  serviceLine ENUM('laundry_butler', 'laundry_farm_core', 'unresolved') NOT NULL,
  evidenceReference VARCHAR(255) NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenantId, eventKey)
);
CREATE TABLE IF NOT EXISTS sales_source_revisions (
  tenantId VARCHAR(64) NOT NULL,
  orderId VARCHAR(128) NOT NULL,
  reportType ENUM('orders_sales', 'orders_revenue') NOT NULL,
  fingerprint VARCHAR(64) NOT NULL,
  importBatchId INT NOT NULL,
  amounts JSON NOT NULL,
  dates JSON NOT NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenantId, orderId, reportType, fingerprint)
);
