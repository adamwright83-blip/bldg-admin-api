CREATE TABLE IF NOT EXISTS mitch_producer_events (
  event_id varchar(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  payload_hash varchar(64) NOT NULL,
  payload_json json NOT NULL,
  status varchar(24) NOT NULL,
  last_error text NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX mitch_events_pending (status, created_at)
);
CREATE TABLE IF NOT EXISTS mitch_producer_deliveries (
  delivery_id varchar(128) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  event_id varchar(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
