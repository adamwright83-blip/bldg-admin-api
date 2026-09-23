import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migrate = readFileSync(new URL("../../scripts/migrate.mjs", import.meta.url), "utf8");

function migrationCorpus(): string {
  let text = migrate;
  const patterns = [
    /new URL\(\s*"(\.\.\/[^"]+)"/g,
    /applyIdempotentSqlFile\(\s*"(\.\.\/[^"]+)"/g,
  ];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    for (const match of migrate.matchAll(pattern)) {
      const relative = match[1].replace(/^\.\.\//, "");
      if (seen.has(relative)) continue;
      seen.add(relative);
      text += `\n${readFileSync(new URL(`../../${relative}`, import.meta.url), "utf8")}`;
    }
  }
  return text;
}

function tableNames(sql: string): string[] {
  return [
    ...sql.matchAll(
      /CREATE TABLE(?: IF NOT EXISTS)?\s+\\?`?([A-Za-z0-9_]+)\\?`?\s*\(/gi
    ),
  ].map(match => match[1]);
}

const RUNTIME_GUARDS = [
  "server/externalOrders/externalOrderService.ts",
  "server/storage.ts",
  "server/driverGameWorld/driverGameWorldService.ts",
  "server/commandSky.ts",
  "server/level4War.ts",
  "server/googleCalendar/googleCalendarService.ts",
  "server/goldlineCargo/cargoService.ts",
  "server/openChannel/openChannelService.ts",
  "server/commercialMissions/driverSalesMotivationService.ts",
] as const;

describe("production schema path", () => {
  const corpus = migrationCorpus();

  it("names scripts/migrate.mjs as the production boot authority", () => {
    expect(migrate).toContain("node scripts/migrate.mjs");
    expect(migrate).toContain("does not execute `drizzle/*.sql`");
    expect(migrate).toContain("DAYFORGE_RELEASE_DB=1");
  });

  it("keeps chapter migrations and unapproved capability gaps off this path", () => {
    expect(migrate).not.toContain("../drizzle/0067");
    expect(migrate).not.toContain("../drizzle/0068");
    expect(migrate).not.toContain("../drizzle/0077");
    expect(corpus).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?goldline_capability_gaps`?/i);
    expect(corpus).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?bldg_users`?/i);
    expect(corpus).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?service_requests`?/i);
    expect(corpus).not.toMatch(/CREATE TABLE(?: IF NOT EXISTS)?\s+`?goldline_chapter_states`?/i);
  });

  it("creates every runtime guard table on the production path and leaves the guard in place", () => {
    const corpusTables = new Set(tableNames(corpus));
    for (const file of RUNTIME_GUARDS) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
      const tables = tableNames(source);
      expect(tables.length).toBeGreaterThan(0);
      for (const table of tables) {
        expect(corpusTables.has(table), `${file} creates ${table} outside migrate.mjs`).toBe(true);
      }
      expect(source).toMatch(/CREATE TABLE IF NOT EXISTS/);
    }
  });

  it("applies the Claire conversation ledger and the current open-channel column", () => {
    expect(migrate).toContain("../drizzle/0076_claire_conversation_ledger.sql");
    for (const table of [
      "claire_conversation_sessions",
      "claire_conversation_turns",
      "claire_conversation_transcripts",
      "claire_conversation_analyses",
      "claire_conversation_notifications",
    ]) {
      expect(corpus).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
    }
    expect(migrate).toContain("operatorBriefing");
    expect(migrate).not.toContain("laraBriefing");
  });

  it("creates cold-call base tables before the existing additive alters", () => {
    const attempts = migrate.indexOf("CREATE TABLE IF NOT EXISTS sales_call_attempts");
    const targets = migrate.indexOf("CREATE TABLE IF NOT EXISTS driver_cold_call_targets");
    const link = migrate.indexOf("ALTER TABLE sales_call_attempts ADD COLUMN cold_call_target_id");
    const contact = migrate.indexOf("ALTER TABLE driver_cold_call_targets ADD COLUMN contactId");
    expect(attempts).toBeGreaterThan(-1);
    expect(targets).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(attempts);
    expect(contact).toBeGreaterThan(targets);
  });

  it("creates empty goldline_domain_progression for Project E and does not backfill it", () => {
    expect(migrate).toContain(
      '  "CREATE TABLE goldline_domain_progression"'
    );
    expect(migrate).toContain("CREATE TABLE IF NOT EXISTS goldline_domain_progression");
    expect(migrate).toContain(
      "UNIQUE KEY uq_goldline_domain_progression (tenantId, operatorId)"
    );
    expect(migrate).toContain(
      'await assertRequiredColumns("goldline_domain_progression", ['
    );
    for (const column of [
      "tenantId",
      "operatorId",
      "levelColosseumResolvedAt",
      "companionRookOwnedAt",
      "kingdomBrassRepublicCompletedAt",
      "overworldUnlocksJson",
    ]) {
      expect(migrate).toContain(`"${column}"`);
    }
    expect(migrate).not.toMatch(/INSERT\s+INTO\s+goldline_domain_progression/i);
    const asserted = migrate.slice(
      migrate.indexOf('await assertRequiredColumns("goldline_domain_progression"')
    );
    expect(asserted.slice(0, asserted.indexOf("]);"))).toBe(
      [
        'await assertRequiredColumns("goldline_domain_progression", [',
        '  "tenantId",',
        '  "operatorId",',
        '  "levelColosseumResolvedAt",',
        '  "companionRookOwnedAt",',
        '  "kingdomBrassRepublicCompletedAt",',
        '  "overworldUnlocksJson",',
        "",
      ].join("\n")
    );
  });

  it("does not add business-row writes to the normalized section", () => {
    const section = migrate.split("// BEGIN schema-path-normalized")[1]?.split("// END schema-path-normalized")[0];
    expect(section).toBeTruthy();
    expect(section).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP TABLE)\b/im);
    const ledger = readFileSync(
      new URL("../../drizzle/0076_claire_conversation_ledger.sql", import.meta.url),
      "utf8"
    );
    expect(ledger).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|DROP TABLE)\b/im);
  });
});
