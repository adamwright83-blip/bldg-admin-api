import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../../drizzle/0041_commercial_pipeline_conversion.sql",
    import.meta.url
  ),
  "utf8"
);
const core = readFileSync(
  new URL("./commercialPipelineCore.ts", import.meta.url),
  "utf8"
);
const service = readFileSync(
  new URL("./commercialPipelineService.ts", import.meta.url),
  "utf8"
);
const router = readFileSync(
  new URL("./commercialPipelineRouter.ts", import.meta.url),
  "utf8"
);
const missionStore = readFileSync(
  new URL("../commercialMissions/commercialMissionStore.ts", import.meta.url),
  "utf8"
);
const client = readFileSync(
  new URL("../../client/src/pages/CommercialPipelinePage.tsx", import.meta.url),
  "utf8"
);
const app = readFileSync(
  new URL("../../client/src/App.tsx", import.meta.url),
  "utf8"
);

describe("DayForge commercial pipeline production contract", () => {
  it("persists one tenant-scoped identity, pipeline, conversion graph, and value ledger", () => {
    for (const table of [
      "commercial_pipeline_records",
      "commercial_pipeline_events",
      "commercial_customers",
      "commercial_customer_locations",
      "commercial_customer_contacts",
      "commercial_service_expectations",
      "commercial_agreements",
      "commercial_route_assignments",
      "commercial_follow_ups",
      "commercial_order_attributions",
      "commercial_mission_final_rewards",
    ])
      expect(migration).toContain(`CREATE TABLE \`${table}\``);

    for (const constraint of [
      "uq_commercial_accounts_tenant_identity",
      "uq_commercial_locations_tenant_account_key",
      "uq_commercial_contacts_tenant_account_key",
      "uq_commercial_pipeline_tenant_mission",
      "uq_commercial_customers_tenant_account",
      "uq_commercial_order_attributions_tenant_order",
      "uq_commercial_final_rewards_tenant_mission",
    ])
      expect(migration).toContain(constraint);
  });

  it("creates and advances the pipeline from the canonical mission transaction", () => {
    expect(missionStore).toContain(
      "commercialAccountIdentityKey(input.account)"
    );
    expect(missionStore).toContain(
      "commercialLocationIdentityKey(input)"
    );
    expect(missionStore).toContain(
      "commercialContactIdentityKey({"
    );
    expect(missionStore).toContain("identityKey,");
    expect(missionStore).toContain("createCommercialPipelineForMissionWith(tx");
    expect(missionStore).toContain(
      "syncCommercialPipelineForMissionTransitionWith(tx"
    );
    expect(core).toContain("pipelineStageForMissionStatus");
    expect(core).toContain("reopeningLost");
  });

  it("converts won accounts without overstating agreement or revenue truth", () => {
    expect(core).toContain("commercialCustomerLocations");
    expect(core).toContain("commercialCustomerContacts");
    expect(core).toContain("commercialServiceExpectations");
    expect(core).toContain("commercialRouteAssignments");
    expect(core).toContain('status: "verbal_yes"');
    expect(core).toContain("approvedAnnualValueCents: null");
    expect(core).toContain("commercialMissionFinalRewards");
    expect(service).toContain("invoicedCents: 0");
    expect(service).toContain(
      "const paidCents = order.paid ? cents(order.total) : 0"
    );
    expect(service).toContain("realizedCents: paidCents");
  });

  it("requires explicit proof and tenant order attribution", () => {
    expect(router).toContain(
      "I verified this approved agreement value and its evidence"
    );
    expect(router).toContain(
      "I verified this order belongs to this commercial account"
    );
    expect(service).toContain(
      "COALESCE(${orders.tenantId}, 'default') = ${input.tenantId}"
    );
    expect(service).toContain(
      "COALESCE(${orders.tenantId}, 'default') = ${tenantId}"
    );
    expect(service).toContain("first_order_attributed");
    expect(service).toContain(".innerJoin(");
    expect(service).not.toContain("Promise.all(\n    rows.map(row =>");
    expect(service).toContain("assertPipelineEventPersisted");
    expect(service).toContain("getCommercialMissionByIdempotencyKey");
  });

  it("derives tenant and actor from the admin session and keeps the UI server-backed", () => {
    expect(router).toContain("dayforgePipelineProcedure");
    expect(router).not.toContain("adminProcedure");
    expect(router).toContain("tenantId: ctx.tenantId");
    expect(router).toContain("actorId: ctx.user.openId");
    expect(router).not.toContain("actorId: input.actorId");
    expect(app).toContain('"/commercial-pipeline"');
    expect(client).toContain("commercialPipeline.list.useQuery");
    expect(client).toContain("Paid attributed orders only");
    expect(client).toContain("Confirm migration 0041 is");
    expect(client).not.toContain("localStorage");
  });
});
