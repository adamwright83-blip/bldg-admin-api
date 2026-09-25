import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync(new URL("../../client/src/App.tsx", import.meta.url), "utf8");
const productShell = readFileSync(new URL("../../client/src/product/ProductShell.tsx", import.meta.url), "utf8");
const strategy = readFileSync(new URL("../strategy/strategyRouter.ts", import.meta.url), "utf8");

describe("JOYSTICK customer SaaS surface boundary", () => {
  it("redirects ordinary SaaS users away from historical platform routes", () => {
    expect(app).toContain("SAAS_CUSTOMER_SAFE_PATHS");
    expect(app).toContain('user?.role === "user"');
    expect(app).toContain('return <Redirect to="/product" />');
  });

  it("keeps internal legacy navigation out of ProductShell", () => {
    expect(productShell).not.toContain("Legacy operations");
    expect(productShell).not.toContain('href="/admin"');
    expect(productShell).not.toContain('href="/sales-intel"');
    expect(productShell).not.toContain('href="/vendors"');
    expect(productShell).toContain('href="/dayforge-settings"');
  });

  it("uses tenant membership authority for the Strategy customer surface", () => {
    expect(strategy).toContain("legacyDayforgeTenantOperatorProcedure");
    expect(strategy).not.toContain("adminProcedure");
  });
});
