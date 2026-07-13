import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../../drizzle/0039_commercial_proposals.sql", import.meta.url),
  "utf8"
);
const service = readFileSync(
  new URL("./commercialProposalService.ts", import.meta.url),
  "utf8"
);
const router = readFileSync(
  new URL("./commercialProposalRouter.ts", import.meta.url),
  "utf8"
);
const printClient = readFileSync(
  new URL(
    "../../client/src/pages/CommercialProposalPrint.tsx",
    import.meta.url
  ),
  "utf8"
);
const settingsClient = readFileSync(
  new URL(
    "../../client/src/pages/CommercialProposalSettings.tsx",
    import.meta.url
  ),
  "utf8"
);
const app = readFileSync(
  new URL("../../client/src/App.tsx", import.meta.url),
  "utf8"
);

describe("commercial proposal production contract", () => {
  it("persists tenant profiles, immutable versions, and audit events", () => {
    expect(migration).toContain(
      "CREATE TABLE `tenant_commercial_proposal_profiles`"
    );
    expect(migration).toContain("CREATE TABLE `commercial_proposals`");
    expect(migration).toContain("CREATE TABLE `commercial_proposal_events`");
    expect(migration).toContain(
      "uq_commercial_proposals_tenant_mission_version"
    );
    expect(migration).toContain(
      "uq_commercial_proposal_events_tenant_idempotency"
    );
  });

  it("builds snapshots from persisted mission and profile data", () => {
    expect(service).toContain("buildCommercialLaundryProposal");
    expect(service).toContain("readCommercialMissionWith(tx, input)");
    expect(service).toContain("readProfileWith(tx, input.tenantId)");
    expect(service).not.toContain("DEMO_STORE");
    expect(service).not.toContain("DEMO_MISSION");
  });

  it("requires explicit approval and records browser print honestly", () => {
    expect(service).toContain('eventName: "proposal_approved"');
    expect(service).toContain('eventName: "browser_print_opened"');
    expect(service).toContain("completionClaimed: false");
    expect(service).toContain("Only approved collateral can be printed");
    expect(service).toContain(
      "Only the latest proposal version can be approved"
    );
  });

  it("derives tenant and actor from signed procedures", () => {
    expect(router).toContain("dayforgeProposalOperatorProcedure");
    expect(router).toContain("dayforgeProposalFieldProcedure");
    expect(router).not.toContain("adminProcedure");
    expect(router).not.toContain("adminOrDriverProcedure");
    expect(router).not.toContain("protectedProcedure");
    expect(router).toContain("assertDriverCanReadMission");
    expect(router).toContain("tenantId: ctx.tenantId");
    expect(router).toContain("actorId: ctx.user.openId");
    expect(router).not.toContain("actorId: input.actorId");
  });

  it("routes server-backed proposal surfaces without browser storage", () => {
    expect(app.match(/\/commercial-proposal\/:missionId/g)).toHaveLength(2);
    expect(app).toContain('"/commercial-proposal-settings"');
    expect(printClient).toContain("commercialProposal.forMission.useQuery");
    expect(printClient).toContain("commercialProposal.recordBrowserPrint");
    expect(settingsClient).toContain("commercialProposal.saveProfile");
    expect(printClient).not.toContain("localStorage");
    expect(settingsClient).not.toContain("localStorage");
  });
});
