-- Reverses drizzle/0151_courtyard_discoveries.sql. Drops only the airmail's discoveries column (fiction progress);
-- every other column of lantern_neighborhood_memories is untouched.
-- Run by hand (it is not part of scripts/migrate.mjs): mysql ... < drizzle/0151_courtyard_discoveries.rollback.sql
ALTER TABLE `lantern_neighborhood_memories` DROP COLUMN `courtyard_discoveries_json`;
