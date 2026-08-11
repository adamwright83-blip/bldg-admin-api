import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The admin/driver boundary is a product rule, not a UI detail: `/driver` and
 * driver-role users must never reach Sales Intel ingestion or corpus
 * administration. These assertions read the routers directly so the guarantee
 * cannot be quietly weakened by adding an ungated procedure later.
 */
const salesIntelRouterSource = readFileSync(
  resolve(import.meta.dirname, "salesIntelRouter.ts"),
  "utf8"
);
const armoryRouterSource = readFileSync(
  resolve(import.meta.dirname, "..", "armory", "armoryRouter.ts"),
  "utf8"
);
const trpcSource = readFileSync(
  resolve(import.meta.dirname, "..", "_core", "trpc.ts"),
  "utf8"
);

/**
 * Every `name: <procedure>` binding declared in a router module, at the
 * top level or nested one level inside a sub-router (e.g.
 * `sourceRegistry: router({ create: adminProcedure... })`) — the admin/
 * driver boundary must hold at both nesting levels.
 */
function declaredProcedures(source: string): string[] {
  return [
    ...source.matchAll(/^\s{2,4}(?:\/\*\*[\s\S]*?\*\/\s*)?([a-zA-Z]+):\s*([a-zA-Z]+Procedure)/gm),
  ].map(match => `${match[1]}:${match[2]}`);
}

describe("Sales Intel administration is admin-only", () => {
  it("gates every ingestion and corpus procedure on adminProcedure", () => {
    const procedures = declaredProcedures(salesIntelRouterSource);
    expect(procedures.length).toBeGreaterThan(0);
    for (const procedure of procedures) {
      expect(procedure.endsWith(":adminProcedure")).toBe(true);
    }
  });

  it("exposes ingest, attachContent, reextract, review and importCorpus only as admin", () => {
    for (const name of [
      "ingest",
      "attachContent",
      "reextract",
      "review",
      "importCorpus",
      "sources",
      "source",
      "adapters",
      "frameworkVersions",
      "list",
      "create",
      "setStatus",
      "recentArtifacts",
      "checkNow",
      "checkAllEnabled",
      "reviewQueue",
    ]) {
      expect(salesIntelRouterSource).toMatch(
        new RegExp(`${name}:\\s*adminProcedure`)
      );
    }
  });

  it("never falls back to a driver-reachable procedure", () => {
    expect(salesIntelRouterSource).not.toMatch(/adminOrDriverProcedure/);
    expect(salesIntelRouterSource).not.toMatch(/dayforge\w*Procedure/);
    expect(salesIntelRouterSource).not.toMatch(/publicProcedure/);
    expect(salesIntelRouterSource).not.toMatch(/protectedProcedure/);
  });

  it("keeps adminProcedure itself restricted to the platform admin role", () => {
    // The gate that makes all of the above meaningful.
    expect(trpcSource).toMatch(
      /export const adminProcedure[\s\S]{0,240}ctx\.user\.role !== "admin"/
    );
  });
});

describe("the driver consumes intelligence but cannot administer it", () => {
  it("serves gameplay Armory reads on driver-reachable procedures", () => {
    expect(armoryRouterSource).toMatch(/weapons:\s*dayforgeMissionFieldProcedure/);
    expect(armoryRouterSource).toMatch(
      /recordUsage:\s*dayforgeMissionFieldProcedure/
    );
  });

  it("exposes no ingestion or review capability through the Armory router", () => {
    for (const forbidden of [
      "ingestSalesIntelSource",
      "attachSalesIntelContent",
      "reextractSalesIntelSource",
      "setFrameworkReviewState",
      "importSalesIntelCorpus",
      "listSourceArtifacts",
    ]) {
      expect(armoryRouterSource).not.toContain(forbidden);
    }
  });

  it("binds no procedure in the gameplay router to adminProcedure", () => {
    // Matches a real binding, not a mention in a comment.
    expect(armoryRouterSource).not.toMatch(/:\s*adminProcedure/);
    expect(armoryRouterSource).not.toMatch(
      /import[\s\S]{0,200}\badminProcedure\b[\s\S]{0,200}from "\.\.\/_core\/trpc"/
    );
  });
});
