import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectPhysicalWorldState } from "./goldlineWorld";
import type { GoldlineWorldEvent } from "./goldlineWorld";

const read = (relative: string) =>
  readFileSync(join(__dirname, "..", relative), "utf8");

const event = (
  overrides: Partial<GoldlineWorldEvent> & Pick<GoldlineWorldEvent, "id" | "eventType">
): GoldlineWorldEvent => ({
  tenantId: "default",
  physicalEntityId: "building-1",
  classification: "action",
  actorType: "operator",
  actorId: "operator-1",
  occurredAt: "2026-09-01T12:00:00.000Z",
  observedAt: null,
  sourceType: "test_fixture",
  sourceId: overrides.id,
  sourceEvidenceReference: `test:${overrides.id}`,
  provenanceClass: "operator_reported",
  verificationClass: "ATTESTED",
  confidence: "high",
  idempotencyKey: overrides.id,
  correlationId: overrides.id,
  metadata: {},
  ...overrides,
});

describe("recoveryState canonical semantics", () => {
  it("sets attempted only from recovery_outreach_completed action events", () => {
    const attempted = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [
        event({
          id: "outreach",
          eventType: "recovery_outreach_completed",
          classification: "action",
        }),
      ],
      residentCount: 1,
      activeResidentCount: 0,
      epistemicState: "confirmed",
    });
    expect(attempted.recoveryState).toBe("attempted");
  });

  it("does not treat proposal_sent or visited as attempted recovery", () => {
    const projection = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [
        event({ id: "visit", eventType: "visited", classification: "action" }),
        event({
          id: "proposal",
          eventType: "proposal_sent",
          classification: "action",
        }),
      ],
      residentCount: 1,
      activeResidentCount: 0,
      epistemicState: "confirmed",
    });
    expect(projection.recoveryState).toBe("none");
  });

  it("sets recovered only from customer_recovered outcome events", () => {
    const recovered = projectPhysicalWorldState({
      physicalEntityId: "building-1",
      events: [
        event({
          id: "outreach",
          eventType: "recovery_outreach_completed",
          classification: "action",
        }),
        event({
          id: "win",
          eventType: "customer_recovered",
          classification: "outcome",
          provenanceClass: "existing_business_record",
          verificationClass: "VERIFIED",
          actorType: "customer",
          actorId: null,
        }),
      ],
      residentCount: 1,
      activeResidentCount: 1,
      epistemicState: "confirmed",
    });
    expect(recovered.recoveryState).toBe("recovered");
  });
});

describe("recovery presentation cannot be manufactured in the client", () => {
  it("does not append world events from Rekindling tool selection", () => {
    const arsenal = read("client/src/components/admin/control-room/RekindlingArsenal.tsx");
    const atlas = read("client/src/components/admin/control-room/LanternCityAtlas.tsx");
    expect(arsenal).not.toContain("appendGoldlineWorldEvent");
    expect(arsenal).not.toContain("recovery_outreach_completed");
    expect(atlas).not.toContain("recovery_outreach_completed");
    expect(atlas).not.toContain("customer_recovered");
  });

  it("derives spark/restored only from projection evidence, not tool clicks", () => {
    const presentation = read(
      "client/src/components/admin/control-room/lanternCustomerPresentation.ts"
    );
    expect(presentation).toContain('projection.recoveryState === "recovered"');
    expect(presentation).toContain('projection.recoveryState === "attempted"');
    expect(presentation).not.toContain("onSelectTool");
  });
});
