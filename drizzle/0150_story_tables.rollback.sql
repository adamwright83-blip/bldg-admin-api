-- Reverses drizzle/0150_story_tables.sql. Drops only the six story tables; touches nothing else.
-- Run by hand (it is not part of scripts/migrate.mjs): mysql ... < drizzle/0150_story_tables.rollback.sql
DROP TABLE IF EXISTS story_attempts;
DROP TABLE IF EXISTS story_answers;
DROP TABLE IF EXISTS story_progress;
DROP TABLE IF EXISTS story_lines;
DROP TABLE IF EXISTS story_chapters;
DROP TABLE IF EXISTS story_seasons;
