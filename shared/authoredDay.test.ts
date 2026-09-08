import { describe, expect, it } from "vitest";
import {
  applyAuthoredDayOrdering,
  applyAuthoredDayPlan,
  introducesUnsupportedFactualClaim,
  isBusyworkMission,
  reconstructAuthoredLinesFromCandidates,
  validateAuthoredDayLines,
  validatePresentationCopy,
  type AuthoredDayAllowlist,
  type AuthoredDayLine,
} from "./authoredDay";

function allowlist(overrides: Partial<Record<keyof AuthoredDayAllowlist, string[]>> = {}) {
  return {
    customerIds: new Set(overrides.customerIds ?? ["cust-1"]),
    physicalEntityIds: new Set(overrides.physicalEntityIds ?? ["pe-1"]),
    fieldItemIds: new Set(overrides.fieldItemIds ?? ["pickup:42"]),
    obligationIds: new Set(overrides.obligationIds ?? ["obl-1"]),
    territoryIds: new Set(overrides.territoryIds ?? ["koreatown"]),
    operationStableKeys: new Set(overrides.operationStableKeys ?? ["op-1"]),
    campaignChapterIds: new Set(overrides.campaignChapterIds ?? ["ch-1"]),
    orderIds: new Set(overrides.orderIds ?? ["42"]),
    followUpIds: new Set(overrides.followUpIds ?? ["fu-1"]),
    externalOrderIds: new Set(overrides.externalOrderIds ?? ["ext-1"]),
    missionIds: new Set(overrides.missionIds ?? ["m-1"]),
  } satisfies AuthoredDayAllowlist;
}

function line(overrides: Partial<AuthoredDayLine> = {}): AuthoredDayLine {
  return {
    id: "line-1",
    title: "Pick up Ada",
    narrative: "Real pickup on the route.",
    kind: "pickup",
    emphasis: "primary",
    provenance: [
      {
        entityType: "field_item",
        entityId: "pickup:42",
        sourceReference: "orders:42",
      },
      {
        entityType: "order",
        entityId: "42",
        sourceReference: "orders:42",
      },
    ],
    ...overrides,
  };
}

describe("authored day truth firewall", () => {
  it("accepts valid model output using only supplied IDs", () => {
    expect(validateAuthoredDayLines([line()], allowlist())).toEqual({ ok: true });
  });

  it("rejects hallucinated customer IDs", () => {
    const result = validateAuthoredDayLines(
      [
        line({
          provenance: [
            {
              entityType: "customer",
              entityId: "fake-customer-999",
              sourceReference: "customers:999",
            },
          ],
        }),
      ],
      allowlist()
    );
    expect(result.ok).toBe(false);
  });

  it("rejects hallucinated building IDs", () => {
    const result = validateAuthoredDayLines(
      [
        line({
          provenance: [
            {
              entityType: "physical_entity",
              entityId: "00000000-0000-4000-8000-000000000999",
              sourceReference: "physical_entities:999",
            },
          ],
        }),
      ],
      allowlist()
    );
    expect(result.ok).toBe(false);
  });

  it("rejects hallucinated stop IDs", () => {
    expect(
      validateAuthoredDayLines(
        [line({ provenance: [{ entityType: "field_item", entityId: "pickup:999", sourceReference: "orders:999" }] })],
        allowlist()
      ).ok
    ).toBe(false);
  });

  it("rejects hallucinated obligation IDs", () => {
    expect(
      validateAuthoredDayLines(
        [
          line({
            provenance: [
              {
                entityType: "obligation",
                entityId: "obl-fake",
                sourceReference: "goldline_world_events:fake",
              },
            ],
          }),
        ],
        allowlist()
      ).ok
    ).toBe(false);
  });

  it("rejects hallucinated territory/geography", () => {
    expect(
      validateAuthoredDayLines(
        [
          line({
            provenance: [
              {
                entityType: "territory",
                entityId: "fake-neighborhood",
                sourceReference: "lantern_city_territories:fake",
              },
            ],
          }),
        ],
        allowlist()
      ).ok
    ).toBe(false);
  });

  it("rejects invented meetings presented as obligations without allowlist backing", () => {
    expect(
      validateAuthoredDayLines(
        [
          line({
            title: "Meet Sarah at 2 PM",
            narrative: "Confirmed meeting downtown.",
            provenance: [
              {
                entityType: "field_item",
                entityId: "meeting:fake",
                sourceReference: "meetings:fake",
              },
            ],
          }),
        ],
        allowlist()
      ).ok
    ).toBe(false);
  });

  it("rejects invented business outcomes", () => {
    expect(
      validateAuthoredDayLines(
        [
          line({
            title: "Closed the Greystar deal",
            narrative: "Revenue booked overnight.",
            provenance: [
              {
                entityType: "commercial_mission",
                entityId: "m-fake-win",
                sourceReference: "commercial_missions:999",
              },
            ],
          }),
        ],
        allowlist()
      ).ok
    ).toBe(false);
  });

  it("requires provenance on every line", () => {
    expect(validateAuthoredDayLines([line({ provenance: [] })], allowlist()).ok).toBe(
      false
    );
  });

  it("rejects dashboard busywork missions", () => {
    expect(isBusyworkMission("Review dashboard metrics")).toBe(true);
    expect(
      validateAuthoredDayLines(
        [line({ title: "Review dashboard", narrative: "Update CRM fields" })],
        allowlist()
      ).ok
    ).toBe(false);
  });

  it("reorders stops from authored field-item provenance", () => {
    const ordered = applyAuthoredDayOrdering(
      [
        { id: "native-pickup-99" },
        { id: "native-pickup-42" },
      ],
      [
        line({
          provenance: [
            { entityType: "field_item", entityId: "pickup:42", sourceReference: "orders:42" },
          ],
        }),
        line({
          id: "line-2",
          provenance: [
            { entityType: "field_item", entityId: "pickup:99", sourceReference: "orders:99" },
          ],
        }),
      ]
    );
    expect(ordered.map(item => item.id)).toEqual(["native-pickup-42", "native-pickup-99"]);
  });
});

describe("semantic truth firewall", () => {
  const candidates = [
    line({ id: "line:pickup:42", title: "Pick up Ada", narrative: "Scheduled pickup." }),
    line({
      id: "line:mission:7",
      title: "Visit Greystar",
      narrative: "Commercial mission ready.",
      kind: "commercial",
      provenance: [
        {
          entityType: "commercial_mission",
          entityId: "m-1",
          sourceReference: "commercial_missions:7",
        },
      ],
    }),
    line({
      id: "line:obl:1",
      title: "Return call",
      narrative: "Open obligation.",
      kind: "obligation",
      provenance: [
        {
          entityType: "obligation",
          entityId: "obl-1",
          sourceReference: "goldline_world_events:obl-1",
        },
      ],
    }),
  ];

  it("reconstructs canonical line text even when a plan only selects valid IDs", () => {
    const reconstructed = reconstructAuthoredLinesFromCandidates(candidates, {
      selections: [{ candidateId: "line:pickup:42", emphasis: "primary" }],
    });
    expect(reconstructed.ok).toBe(true);
    if (reconstructed.ok) {
      expect(reconstructed.lines[0]?.title).toBe("Pick up Ada");
      expect(reconstructed.lines[0]?.narrative).toBe("Scheduled pickup.");
    }
  });

  it("cannot persist fabricated meeting prose on a valid field_item selection", () => {
    const applied = applyAuthoredDayPlan({
      candidateLines: candidates,
      allowlist: allowlist(),
      headlineSeed: "Tomorrow on 2026-09-09",
      framingSeed: "Real work only.",
      plan: {
        headline: "The Line bends toward Silver Lake.",
        framing: "Real work only.",
        selections: [{ candidateId: "line:pickup:42", emphasis: "primary" }],
      },
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.lines[0]?.title).not.toContain("Confirmed meeting");
      expect(applied.lines[0]?.narrative).not.toContain("Sarah at 2 PM");
    }
  });

  it("rejects unsupported factual headline copy", () => {
    expect(
      validatePresentationCopy("Dana is waiting for pricing at 2 PM").ok
    ).toBe(false);
    expect(introducesUnsupportedFactualClaim("Greystar signed the deal")).toBe(
      true
    );
  });

  it("falls back to seeds when headline or framing introduce unsupported facts", () => {
    const applied = applyAuthoredDayPlan({
      candidateLines: candidates,
      allowlist: allowlist(),
      headlineSeed: "Tomorrow on 2026-09-09",
      framingSeed: "Real work only.",
      plan: {
        headline: "Confirmed meeting with Sarah at 2 PM",
        framing: "Three customers are ready to return.",
        selections: [{ candidateId: "line:pickup:42", emphasis: "primary" }],
      },
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.headline).toBe("Tomorrow on 2026-09-09");
      expect(applied.framing).toBe("Real work only.");
    }
  });

  it("preserves ordering and emphasis from canonical candidate selections", () => {
    const applied = applyAuthoredDayPlan({
      candidateLines: candidates,
      allowlist: allowlist(),
      headlineSeed: "Tomorrow",
      framingSeed: "Work",
      plan: {
        headline: "The Line bends toward Silver Lake.",
        framing: "Pressure first, then pickups.",
        selections: [
          { candidateId: "line:mission:7", emphasis: "primary" },
          { candidateId: "line:pickup:42", emphasis: "secondary" },
        ],
      },
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      expect(applied.lines.map(item => item.id)).toEqual([
        "line:mission:7",
        "line:pickup:42",
      ]);
      expect(applied.lines[0]?.emphasis).toBe("primary");
      expect(applied.lines[1]?.emphasis).toBe("secondary");
    }
  });

  const fakeFactCases = [
    {
      label: "valid field_item + meeting prose impossible in reconstructed line",
      candidateId: "line:pickup:42",
    },
    {
      label: "valid commercial_mission selection keeps canonical mission text",
      candidateId: "line:mission:7",
    },
    {
      label: "valid obligation selection keeps canonical obligation text",
      candidateId: "line:obl:1",
    },
  ];

  it.each(fakeFactCases)("$label", ({ candidateId }) => {
    const applied = applyAuthoredDayPlan({
      candidateLines: candidates,
      allowlist: allowlist(),
      headlineSeed: "Tomorrow",
      framingSeed: "Work",
      plan: {
        headline: "The Line bends toward Silver Lake.",
        framing: "Pressure first.",
        selections: [{ candidateId, emphasis: "primary" }],
      },
    });
    expect(applied.ok).toBe(true);
    if (applied.ok) {
      const canonical = candidates.find(item => item.id === candidateId);
      expect(applied.lines[0]?.title).toBe(canonical?.title);
      expect(applied.lines[0]?.narrative).toBe(canonical?.narrative);
      expect(applied.lines[0]?.title).not.toMatch(/signed the deal|revenue booked|2 PM/i);
    }
  });
});
