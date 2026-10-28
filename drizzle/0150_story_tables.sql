-- Story seasons (the nightly chapter on the main account page). Additive only: six new tables, nothing existing is
-- altered. Authored text lives in story_lines and is seeded from a private file at deploy time, never from the repo.
-- Rollback: drizzle/0150_story_tables.rollback.sql drops exactly these six tables.
CREATE TABLE IF NOT EXISTS story_seasons (
  id int NOT NULL AUTO_INCREMENT,
  slug varchar(64) NOT NULL,
  title varchar(200) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'draft',
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_story_seasons_slug (slug)
);

CREATE TABLE IF NOT EXISTS story_chapters (
  id int NOT NULL AUTO_INCREMENT,
  season_id int NOT NULL,
  chapter_number int NOT NULL,
  game_key varchar(64) NOT NULL,
  title varchar(200) NOT NULL,
  question_key varchar(64) NULL,
  config_json json NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_story_chapters_season_number (season_id, chapter_number)
);

CREATE TABLE IF NOT EXISTS story_lines (
  id int NOT NULL AUTO_INCREMENT,
  chapter_id int NOT NULL,
  slot varchar(16) NOT NULL,
  line_key varchar(64) NOT NULL,
  variant_key varchar(64) NOT NULL DEFAULT 'default',
  sort_order int NOT NULL DEFAULT 0,
  condition_json json NULL,
  text text NOT NULL,
  still_id varchar(128) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_story_lines_variant (chapter_id, line_key, variant_key),
  KEY idx_story_lines_chapter (chapter_id)
);

CREATE TABLE IF NOT EXISTS story_progress (
  id int NOT NULL AUTO_INCREMENT,
  tenant_id varchar(64) NOT NULL,
  operator_id varchar(128) NOT NULL,
  season_id int NOT NULL,
  highest_chapter_won int NOT NULL DEFAULT 0,
  last_won_on date NULL,
  last_played_on date NULL,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_story_progress_operator_season (tenant_id, operator_id, season_id)
);

CREATE TABLE IF NOT EXISTS story_answers (
  id int NOT NULL AUTO_INCREMENT,
  tenant_id varchar(64) NOT NULL,
  operator_id varchar(128) NOT NULL,
  season_id int NOT NULL,
  question_key varchar(64) NOT NULL,
  option_key varchar(64) NOT NULL,
  answered_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_story_answers_once (tenant_id, operator_id, season_id, question_key)
);

CREATE TABLE IF NOT EXISTS story_attempts (
  id int NOT NULL AUTO_INCREMENT,
  tenant_id varchar(64) NOT NULL,
  operator_id varchar(128) NOT NULL,
  season_id int NOT NULL,
  chapter_number int NOT NULL,
  outcome varchar(8) NOT NULL,
  duration_ms int NULL,
  local_date date NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_story_attempts_operator (tenant_id, operator_id, season_id)
);
