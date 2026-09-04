import { describe, expect, it } from "vitest";
import type { GoldlineWorldEvent } from "../../shared/goldlineWorld";
import {
  activeFieldSignals,
  FIELD_SIGNAL_EVENT,
  FIELD_SIGNAL_SUPERSEDED_EVENT,
  futurePressureFromEvents,
} from "./futurePressureService";

const BUILDING = "building-el-royale";

function event(input: {
  id: string;
  eventType: string;
  occurredAt: string;
  sourceEvidenceReference: string;
  metadata: Record<string, unknown>;
  physicalEntityId?: string | null;
}): GoldlineWorldEvent {
  return {
    id: input.id,
    tenantId: "tenant-1",
    physicalEntityId: input.physicalEntityId ?? BUILDING,
    eventType: input.eventType,
    classification: "evidence",
    actorType: "operator",
    actorId: "operator-1",
    occurredAt: input.occurredAt,
    observedAt: null,
    sourceType: "driver_sales_journals",
    sourceId: input.sourceEvidenceReference.split(":")[1] ?? input.id,
    sourceEvidenceReference: input.sourceEvidenceReference,
    provenanceClass: "operator_reported",
    verificationClass: "ATTESTED",
    confidence: "medium",
    idempotencyKey: input.id,
    correlationId: "field-journal",
    metadata: input.metadata,
  };
}

const wednesday = event({
  id: "signal-wed",
  eventType: FIELD_SIGNAL_EVENT,
  occurredAt: "2026-09-01T19:00:00.000Z",
  sourceEvidenceReference: "driver_sales_journals:journal-1",
  metadata: {
    kind: "reported_availability",
    statement: "Front desk said she is back Wednesday",
    subject: "Sarah is back",
    whenText: "Wednesday",
    anchorDate: "2026-09-01",
  },
});

const thursday = event({
  id: "signal-thu",
  eventType: FIELD_SIGNAL_EVENT,
  occurredAt: "2026-09-01T22:00:00.000Z",
  sourceEvidenceReference: "driver_sales_journals:journal-2",
  metadata: {
    kind: "reported_availability",
    statement: "They said she is actually back Thursday",
    subject: "Sarah is back",
    whenText: "Thursday",
    anchorDate: "2026-09-01",
  },
});

const correction = event({
  id: "supersede-wed",
  eventType: FIELD_SIGNAL_SUPERSEDED_EVENT,
  occurredAt: "2026-09-01T22:00:00.000Z",
  sourceEvidenceReference: "driver_sales_journals:journal-2",
  metadata: {
    signalEventId: wednesday.id,
    supersededBySignalEventId: thursday.id,
    reason: "They said she is actually back Thursday",
  },
});

describe("future pressure supersession", () => {
  it("keeps old evidence in Chronicle while removing it from the active future", () => {
    const chronicle = [wednesday, correction, thursday];
    expect(chronicle.map(item => item.id)).toContain("signal-wed");
    expect(activeFieldSignals(chronicle).map(item => item.id)).toEqual(["signal-thu"]);
  });

  it("proves Tuesday's corrected Wednesday does not create a Wednesday ghost", () => {
    const pressure = futurePressureFromEvents({
      date: "2026-09-02",
      events: [wednesday, correction, thursday],
    });
    expect(pressure.items).toEqual([]);
  });

  it("brings the corrected opportunity back on Thursday with new provenance", () => {
    const pressure = futurePressureFromEvents({
      date: "2026-09-03",
      events: [wednesday, correction, thursday],
    });
    expect(pressure.items).toHaveLength(1);
    expect(pressure.items[0]!.sourceEvidenceReference).toBe("driver_sales_journals:journal-2");
    expect(pressure.items[0]!.reason).toMatch(/2026-09-03/);
  });

  it("does not erase an unrelated signal at another building", () => {
    const other = event({
      id: "signal-other",
      eventType: FIELD_SIGNAL_EVENT,
      occurredAt: "2026-09-01T20:00:00.000Z",
      sourceEvidenceReference: "driver_sales_journals:journal-other",
      physicalEntityId: "building-other",
      metadata: {
        kind: "reported_availability",
        statement: "Manager said he is back Wednesday",
        subject: "Manager is back",
        whenText: "Wednesday",
        anchorDate: "2026-09-01",
      },
    });
    const pressure = futurePressureFromEvents({
      date: "2026-09-02",
      events: [wednesday, correction, thursday, other],
    });
    expect(pressure.items.map(item => item.physicalEntityId)).toEqual(["building-other"]);
  });
});
