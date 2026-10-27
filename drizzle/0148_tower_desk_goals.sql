-- The monthly revenue goal an operator sets for one of their towers from the front desk's elevator.
CREATE TABLE IF NOT EXISTS tower_desk_goals (
  id int NOT NULL AUTO_INCREMENT,
  tenant_id varchar(64) NOT NULL,
  building_id varchar(32) NOT NULL,
  monthly_goal_cents int NOT NULL,
  updated_by varchar(128) NULL,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tower_desk_goals_tenant_building (tenant_id, building_id)
);
