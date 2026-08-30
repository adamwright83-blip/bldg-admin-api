import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeSourceAddress } from "./geographicTruthService";

const root = path.resolve(import.meta.dirname, "../..");
const schema = fs.readFileSync(path.join(root, "drizzle/schema.ts"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "drizzle/0060_goldline_truth_bound_world.sql"),
  "utf8"
);
const bootstrap = fs.readFileSync(
  path.join(root, "scripts/migrate.mjs"),
  "utf8"
);
const atlas = fs.readFileSync(
  path.join(
    root,
    "client/src/components/admin/control-room/LanternCityAtlas.tsx"
  ),
  "utf8"
);
const service = fs.readFileSync(
  path.join(root, "server/geography/geographicTruthService.ts"),
  "utf8"
);

describe("Goldline geographic truth contract", () => {
  it("normalizes equivalent source addresses for cache reuse", () => {
    expect(normalizeSourceAddress(" 3545 Wilshire Blvd., Los Angeles ")).toBe(
      "3545 wilshire blvd los angeles"
    );
  });

  it("keeps schema, migration, and fail-closed production bootstrap aligned", () => {
    for (const field of [
      "entity_locations",
      "normalizedSourceAddress",
      "googlePlaceId",
      "geocodeStatus",
      "tower_wars_promises",
      "permissionEvidence",
    ]) {
      expect(schema).toContain(field);
      expect(migration).toContain(field);
      expect(bootstrap).toContain(field);
    }
    expect(bootstrap).toContain('assertRequiredColumns("entity_locations"');
    expect(bootstrap).toContain('assertRequiredColumns("tower_wars_promises"');
  });

  it("has no heuristic neighborhood placement fallback", () => {
    expect(atlas).not.toContain("resolveCustomerMapLocation");
    expect(atlas).not.toMatch(/90069|90210|wilshire blvd/i);
    expect(atlas).toContain("customer.location");
  });

  it("does not limit multiplied prospect joins before deduplication", () => {
    expect(service).not.toContain(".limit(500)");
    expect(service).toContain("deduplicateDiscoveredEntities");
  });
});
