import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_BUSINESS_NAME, DEMO_TENANT_ID, demoBypassEnabled, protectedTenantIds } from "./demoAccess";

const repo = (...p: string[]) => fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", ...p), "utf8");
const server = repo("server", "goldlineOnboarding", "demoAccess.ts");
const client = repo("client", "src", "components", "goldline", "onboarding", "DemoAccess.tsx");
const app = repo("client", "src", "App.tsx");
const onboarding = repo("client", "src", "components", "goldline", "onboarding", "GoldlineOnboarding.tsx");

describe("demo bypass is dark by default", () => {
  it("is disabled unless the explicit flag is set", () => {
    const original = process.env.GOLDLINE_DEMO_BYPASS;
    try {
      delete process.env.GOLDLINE_DEMO_BYPASS;
      expect(demoBypassEnabled()).toBe(false);
      process.env.GOLDLINE_DEMO_BYPASS = "1";
      expect(demoBypassEnabled()).toBe(false);
      process.env.GOLDLINE_DEMO_BYPASS = "TRUE";
      expect(demoBypassEnabled()).toBe(false);
      process.env.GOLDLINE_DEMO_BYPASS = "true";
      expect(demoBypassEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.GOLDLINE_DEMO_BYPASS;
      else process.env.GOLDLINE_DEMO_BYPASS = original;
    }
  });

  it("404s every mutating route while disabled, so a normal deploy shows no door", () => {
    expect(server).toContain('res.status(404).json({ error: "Not found" })');
    for (const route of ["/api/goldline/demo/bypass-login", "/api/goldline/demo/reset"])
      expect(server).toMatch(new RegExp(`app\\.post\\("${route.replace(/\//g, "\\/")}", guard`));
    // The client renders nothing at all unless the server says enabled.
    expect(client).toContain("if (!capability?.enabled) return null;");
  });
});

describe("demo bypass cannot reach a real tenant", () => {
  it("targets one compile-time fixture tenant that no request can steer", () => {
    expect(DEMO_TENANT_ID).toBe("goldline-dp-wright-contractors");
    expect(DEMO_BUSINESS_NAME).toBe("WRIGHT CONTRACTORS");
    expect(protectedTenantIds().has(DEMO_TENANT_ID)).toBe(false);
    // The tenant id is a constant, never read from the request.
    expect(server).toContain('export const DEMO_TENANT_ID = "goldline-dp-wright-contractors"');
    expect(server).not.toMatch(/req\.(body|query|params)[^\n]*[Tt]enant/);
  });

  it("refuses to boot if the fixture id is ever pointed at a real tenant", () => {
    expect(server).toContain("if (protectedTenantIds().has(DEMO_TENANT_ID))");
    expect(server).toContain("Refusing to start.");
  });

  it("mints a session only for the single fixture user", () => {
    expect(server).toContain('const DEMO_OPEN_ID = "goldline-demo:wright-contractors"');
    expect(server).toContain("sdk.createSessionToken(DEMO_OPEN_ID");
    // No other openId can be requested.
    expect(server).not.toMatch(/createSessionToken\((?!DEMO_OPEN_ID)/);
  });

  it("scopes every reset delete to the fixture tenant", () => {
    for (const line of server.split("\n").filter(l => /DELETE FROM/.test(l)))
      expect(line).toContain("tenantId=${DEMO_TENANT_ID}");
    expect(server).not.toMatch(/DROP TABLE|TRUNCATE/i);
  });
});

describe("host routing", () => {
  it("serves first-run onboarding at /onboarding and keeps the root for returning customers", () => {
    expect(app).toContain('<Route path="/onboarding">');
    expect(app).toContain('<GoldlineOnboarding entry="onboarding" />');
    // The admin root is untouched: AdminHostApp still owns it.
    expect(app).toContain("<AdminHostRouter />");
  });

  it("redirects a completed session away from /onboarding instead of building a second world", () => {
    expect(onboarding).toContain('if(entry==="onboarding"){window.location.replace("/")');
    // The reveal still owns the world home for every other entry point.
    expect(onboarding).toContain("return <DesignPartnerWorld session={session}/>;");
    // A tenant that already has a canonical world never enters the interview.
    expect(onboarding).toContain('"LEGACY_EXISTING_WORLD"');
  });

  it("offers the bypass to an unauthenticated visitor, which is its purpose", () => {
    const errorBranch = onboarding.split("\n").find(l => l.includes("state.error"))!;
    expect(errorBranch).toContain("<DemoAccess onEntered={reload}/>");
  });

  it("leaves driver.bldg.chat alone", () => {
    expect(app).toContain('const isDriverHost = hostname === "driver.bldg.chat"');
    expect(app).toContain('if (isDriverHost && window.location.pathname !== "/")');
  });
});

describe("production migration creates what the first mission writes to", () => {
  const migrate = repo("scripts", "migrate.mjs");
  const worldSchema = repo("server", "goldlineWorld", "schema.sql");
  const firstMission = repo("server", "goldlineOnboarding", "firstMission.ts");

  it("bootstraps goldline_world_events, which the field outcome inserts into", () => {
    // The first mission's evidence write targets this table.
    expect(firstMission).toContain("tx.insert(goldlineWorldEvents)");
    // migrate.mjs is the production bootstrap and never runs drizzle/*.sql, so
    // the table must be applied from a hand-written schema file.
    expect(migrate).toContain("../server/goldlineWorld/schema.sql");
    expect(migrate).toContain('"Goldline world events"');
    expect(migrate).toContain('assertRequiredColumns("goldline_world_events"');
    expect(worldSchema).toContain("CREATE TABLE IF NOT EXISTS `goldline_world_events`");
    // Every column the insert supplies must exist in the applied definition.
    for (const column of [
      "classification", "actorType", "actorId", "occurredAt", "observedAt",
      "sourceType", "sourceId", "sourceEvidenceReference", "provenanceClass",
      "verificationClass", "confidence", "idempotencyKey", "correlationId", "metadataJson",
    ])
      expect(worldSchema).toContain(`\`${column}\``);
    // Idempotency is what stops a replayed mission multiplying evidence.
    expect(worldSchema).toContain("uq_goldline_world_event_idempotency");
  });

  it("also bootstraps the tables existing-world detection reads", () => {
    for (const table of ["goldline_territory_definitions", "physical_entities"]) {
      expect(worldSchema).toContain(`CREATE TABLE IF NOT EXISTS \`${table}\``);
      expect(migrate).toContain(`assertRequiredColumns("${table}"`);
    }
  });

  it("never lets one missing table 500 the whole onboarding state query", () => {
    const store = repo("server", "goldlineOnboarding", "store.ts");
    expect(store).toContain("existing-world signal");
    // Both signals are attempted independently.
    expect(store).toContain('for (const table of ["physical_entities", "goldline_territory_definitions"])');
    // An unavailable signal is never mistaken for a world that exists.
    expect(store).toContain("return false;");
  });

  it("splits cleanly into statements the migrator can run", () => {
    const statements = worldSchema.split(";").map(s => s.trim()).filter(Boolean);
    expect(statements).toHaveLength(3);
    for (const statement of statements)
      expect(statement).toContain("CREATE TABLE IF NOT EXISTS");
  });
});
