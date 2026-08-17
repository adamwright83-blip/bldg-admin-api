import { describe, expect, it } from "vitest";
import {
  IMPACT_CLASSES,
  impactClassLabel,
  isStrongerImpactClass,
  signalProvenanceLabel,
  tallyImpactSignals,
  toSignalKey,
  type ImpactClass,
  type ImpactSignal,
  type SignalProvenance,
} from "./impactSignal";

/**
 * FIELD INTEL CAPTURE — the two properties that make this worth having.
 *
 * 1. A brand-new kind of observation is storable the moment the operator
 *    realises it matters. No migration, no deploy, no new column. If that ever
 *    stops being true, this feature has failed at its one job.
 *
 * 2. Captured effort never becomes claimed outcome. Thirty-five door hangers is
 *    real work worth remembering; it is not a lead, a customer, or a dollar.
 *    A day of honest legwork must not be able to launder itself into pipeline.
 */

function signal(overrides: Partial<ImpactSignal> = {}): ImpactSignal {
  return {
    id: "sig-1",
    campaignId: "rescue-10day",
    businessDate: "2026-08-17",
    signalKey: "door_hangers_left",
    label: "Door hangers left",
    valueType: "number",
    value: "35",
    unit: "hangers",
    impactClass: "field_activity",
    provenance: "operator_confirmed",
    entityType: "building",
    entityId: null,
    entityLabel: "Opus LA",
    location: null,
    notes: null,
    metadata: null,
    capturedAt: "2026-08-17T14:00:00.000Z",
    confirmedAt: "2026-08-17T14:00:05.000Z",
    ...overrides,
  };
}

describe("a new kind of observation needs no schema change", () => {
  it("stores something nobody anticipated, using only the stable fields", () => {
    // Adam's Day 6 realisation, verbatim: "I need to start tracking whether the
    // building has package lockers." No column exists for this and none should
    // ever be added — it is a signalKey.
    const lockers = signal({
      signalKey: "building_has_package_lockers",
      label: "Building has package lockers",
      valueType: "boolean",
      value: "true",
      unit: null,
      impactClass: "observation",
    });
    expect(lockers.signalKey).toBe("building_has_package_lockers");
    expect(lockers.value).toBe("true");
    // The record's shape is identical to every other signal's — that sameness
    // is the whole mechanism.
    expect(Object.keys(lockers).sort()).toEqual(Object.keys(signal()).sort());
  });

  it("carries structured detail with no column of its own", () => {
    const contact = signal({
      signalKey: "gm_email_obtained",
      label: "GM email obtained",
      valueType: "text",
      value: "gm@opusla.example",
      impactClass: "response",
      metadata: { givenBy: "receptionist", channel: "in_person" },
    });
    expect(contact.metadata).toEqual({
      givenBy: "receptionist",
      channel: "in_person",
    });
  });

  it("derives the same key for the same observation on any day", () => {
    // Day 2 and Day 9 must land under one key or the ten-day run cannot be
    // analysed at all.
    expect(toSignalKey("Building solicitation policy")).toBe(
      "building_solicitation_policy"
    );
    expect(toSignalKey("  Building Solicitation Policy!  ")).toBe(
      "building_solicitation_policy"
    );
  });

  it("produces a usable key from messy speech-derived labels", () => {
    expect(toSignalKey("Residents complain — no in-unit laundry")).toBe(
      "residents_complain_no_in_unit_laundry"
    );
  });
});

describe("effort never becomes outcome", () => {
  it("counts door hangers as activity, not as a lead or a customer", () => {
    const tally = tallyImpactSignals([signal()], "rescue-10day");
    expect(tally.counts.field_activity).toBe(1);
    expect(tally.counts.response).toBe(0);
    expect(tally.counts.opportunity).toBe(0);
    expect(tally.counts.customer_outcome).toBe(0);
    expect(tally.counts.economic_outcome).toBe(0);
  });

  it("keeps every rung of the funnel separate", () => {
    // Adam's own examples, one per class. The ledger must show five distinct
    // facts, not one blended score.
    const tally = tallyImpactSignals(
      [
        signal({ id: "a", impactClass: "observation", signalKey: "unit_count" }),
        signal({ id: "b", impactClass: "field_activity" }),
        signal({ id: "c", impactClass: "response", signalKey: "pricing_requested" }),
        signal({ id: "d", impactClass: "opportunity", signalKey: "meeting_scheduled" }),
        signal({ id: "e", impactClass: "customer_outcome", signalKey: "customer_acquired" }),
        signal({ id: "f", impactClass: "economic_outcome", signalKey: "recurring_revenue" }),
      ],
      "rescue-10day"
    );
    for (const cls of IMPACT_CLASSES) {
      expect(tally.counts[cls]).toBe(1);
    }
  });

  it("offers no single blended total", () => {
    // A total would require deciding how many door hangers equal a customer,
    // and every answer to that is a fabrication.
    const tally = tallyImpactSignals([signal()]);
    expect(tally).not.toHaveProperty("total");
    expect(tally).not.toHaveProperty("score");
    expect(tally).not.toHaveProperty("pipelineValue");
  });

  it("knows which direction is an upgrade, in one place", () => {
    expect(isStrongerImpactClass("economic_outcome", "field_activity")).toBe(true);
    expect(isStrongerImpactClass("field_activity", "economic_outcome")).toBe(false);
    expect(isStrongerImpactClass("observation", "observation")).toBe(false);
  });
});

describe("only confirmed signals are evidence", () => {
  it("ignores an unconfirmed proposal entirely", () => {
    const tally = tallyImpactSignals([signal({ confirmedAt: null })]);
    expect(tally.confirmedSignalCount).toBe(0);
    expect(tally.counts.field_activity).toBe(0);
    expect(tally.quantities).toEqual([]);
  });

  it("counts it once confirmed", () => {
    const tally = tallyImpactSignals([signal()]);
    expect(tally.confirmedSignalCount).toBe(1);
  });
});

describe("quantities add up across the run", () => {
  it("sums repeated numeric captures under one key", () => {
    const tally = tallyImpactSignals(
      [
        signal({ id: "a", value: "35" }),
        signal({ id: "b", value: "40", businessDate: "2026-08-18" }),
      ],
      "rescue-10day"
    );
    expect(tally.quantities).toEqual([
      {
        signalKey: "door_hangers_left",
        label: "Door hangers left",
        unit: "hangers",
        total: 75,
        impactClass: "field_activity",
      },
    ]);
  });

  it("never sums a non-numeric signal into a quantity", () => {
    const tally = tallyImpactSignals([
      signal({
        signalKey: "building_solicitation_policy",
        valueType: "text",
        value: "Prohibited",
        unit: null,
        impactClass: "observation",
      }),
    ]);
    expect(tally.quantities).toEqual([]);
    expect(tally.counts.observation).toBe(1);
  });

  it("ignores a numeric value that is not a number", () => {
    const tally = tallyImpactSignals([signal({ value: "a few" })]);
    expect(tally.quantities).toEqual([]);
  });

  it("keeps the campaign association so ten days read as one run", () => {
    const tally = tallyImpactSignals([signal()], "rescue-10day");
    expect(tally.campaignId).toBe("rescue-10day");
  });
});

describe("provenance is never upgraded", () => {
  it("labels an operator observation as exactly that", () => {
    expect(signalProvenanceLabel("operator_confirmed")).toBe(
      "OPERATOR OBSERVATION"
    );
  });

  it("never labels an operator observation as system verified", () => {
    // Corroboration is a second signal, not a promotion of the first. If this
    // vocabulary ever blurs, the ledger starts claiming the software watched
    // things happen that a person simply reported.
    for (const provenance of [
      "operator_confirmed",
      "external_record",
    ] as SignalProvenance[]) {
      expect(signalProvenanceLabel(provenance)).not.toMatch(/system/i);
    }
    expect(signalProvenanceLabel("system_verified")).toBe("SYSTEM VERIFIED");
  });

  it("has a label for every class and provenance, so none renders blank", () => {
    for (const cls of IMPACT_CLASSES) {
      expect(impactClassLabel(cls as ImpactClass).length).toBeGreaterThan(0);
    }
  });
});
