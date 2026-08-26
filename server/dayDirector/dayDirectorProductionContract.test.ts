import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8")
);
const migration = readFileSync(new URL("scripts/migrate.mjs", root), "utf8");
const component = readFileSync(
  new URL("client/src/pages/goldline/GoldlineDayPlan.tsx", root),
  "utf8"
);

describe("Day Director production persistence contract", () => {
  it("runs the idempotent migration before the production server", () => {
    expect(packageJson.scripts.start).toBe(
      "node scripts/migrate.mjs && NODE_ENV=production node dist/index.js"
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS day_director_commitments"
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS day_director_prompt_states"
    );
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS day_director_processing_locations"
    );
    expect(migration.match(/await runRequired\(/g)).toHaveLength(4);
  });

  it("shows an actionable error instead of swallowing a failed tap", () => {
    expect(component).toContain(
      "Could not add this to Today. Please try again."
    );
    expect(component).toContain('role="alert"');
  });
});
