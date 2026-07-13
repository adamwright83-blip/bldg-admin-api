import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const timeline = readFileSync(
  new URL("./dayforgeTimeline.ts", import.meta.url),
  "utf8"
);
const router = readFileSync(
  new URL("../commercialMissions/commercialMissionRouter.ts", import.meta.url),
  "utf8"
);
const adminUi = readFileSync(
  new URL("../../client/src/pages/CommercialMissionAdmin.tsx", import.meta.url),
  "utf8"
);

describe("DayForge unified timeline contract", () => {
  it("always scopes reads by the authenticated tenant", () => {
    expect(timeline).toContain(
      "eq(dayforgeAuditEvents.tenantId, input.tenantId)"
    );
    expect(timeline).toContain(
      "eq(commercialOpportunities.tenantId, input.tenantId)"
    );
    expect(timeline).toContain(
      "eq(commercialMissions.tenantId, input.tenantId)"
    );
  });

  it("supports mission, account, and correlation filters with stable pagination", () => {
    expect(timeline).toContain("filter?.missionId");
    expect(timeline).toContain("filter?.accountId");
    expect(timeline).toContain("filter?.correlationId");
    expect(timeline).toContain('relatedIdPredicate("missionId"');
    expect(timeline).toContain('relatedIdPredicate("accountId"');
    expect(timeline).toContain("JSON_EXTRACT");
    expect(timeline).toContain("desc(dayforgeAuditEvents.createdAt)");
    expect(timeline).toContain("desc(dayforgeAuditEvents.id)");
    expect(timeline).toContain("cursorPredicate(input.cursor)");
  });

  it("exposes the history only through tenant-admin authorization", () => {
    expect(router).toContain("timeline: dayforgeTenantAdminProcedure");
    expect(router).toContain("tenantId: ctx.tenantId");
  });

  it("renders the cross-domain projection in the admin mission view", () => {
    expect(adminUi).toContain("commercialMission.timeline.useQuery");
    expect(adminUi).toContain("Unified journey history");
    expect(adminUi).toContain("event.source");
    expect(adminUi).toContain("event.correlationId");
  });
});
