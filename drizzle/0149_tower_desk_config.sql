-- What the operator tells us about a tower from the front desk's settings, and the building-contract payments they log.
CREATE TABLE IF NOT EXISTS tower_desk_config (
  id int NOT NULL AUTO_INCREMENT,
  tenant_id varchar(64) NOT NULL,
  building_id varchar(32) NOT NULL,
  config_json text NOT NULL,
  updated_by varchar(128) NULL,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tower_desk_config_tenant_building (tenant_id, building_id)
);

CREATE TABLE IF NOT EXISTS tower_desk_contract_payments (
  id int NOT NULL AUTO_INCREMENT,
  tenant_id varchar(64) NOT NULL,
  building_id varchar(32) NOT NULL,
  amount_cents int NOT NULL,
  paid_on varchar(10) NOT NULL,
  note varchar(200) NOT NULL DEFAULT '',
  created_by varchar(128) NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tower_desk_payments_scope (tenant_id, building_id, paid_on)
);
