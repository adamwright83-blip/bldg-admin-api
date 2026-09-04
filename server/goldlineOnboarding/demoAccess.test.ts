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
