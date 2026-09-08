import { describe, expect, it } from "vitest";
import {
  applyAuthoredDayOrdering,
  isBusyworkMission,
  validateAuthoredDayLines,
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
