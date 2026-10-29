-- Rook's airmail in Silver Lake: the courtyard's authored discoveries and the fan's setting, kept on the existing
-- neighbourhood memory row (shared/courtyardDiscoveries.ts). Fiction only; nullable; nothing reads it as business data.
-- Applied by scripts/migrate.mjs through ensureRequiredColumn (idempotent).
ALTER TABLE `lantern_neighborhood_memories` ADD COLUMN `courtyard_discoveries_json` json NULL;
