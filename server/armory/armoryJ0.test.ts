import { describe, expect, it } from "vitest";
import {
  filterArmoryUsagesForAssociation,
  summarizeArmoryAssociations,
} from "./armoryEvidenceService";

describe("Armory J0 outcome accounting", () => {
  it("keeps one real win as one business win across eight usage associations", () => {
    const rows = Array.from({ length: 8 }, (_, index) => ({
      usageId: `usage-${index + 1}`,
      outcomeKind: "account_won" as const,
      outcomeReference: "commercial-account:42:won",
    }));

    expect(summarizeArmoryAssociations(rows)).toEqual({
      usages: 8,
      associations: 8,
      businessOutcomes: 1,
      wins: 1,
    });
  });

  it("keeps different stable outcomes distinct", () => {
    expect(
      summarizeArmoryAssociations([
        {
          usageId: "u1",
          outcomeKind: "follow_up_created",
          outcomeReference: "follow-up:1",
        },
        {
          usageId: "u1",
          outcomeKind: "account_won",
          outcomeReference: "account:1",
        },
      ])
    ).toEqual({
      usages: 1,
      associations: 2,
      businessOutcomes: 2,
      wins: 1,
    });
  });

  it("requires exact lineage before using direct association strengths", () => {
    const usages = [
      { decisionPointId: "dp-1", encounterReference: "enc-1" },
      { decisionPointId: "dp-2", encounterReference: "enc-2" },
    ];

    expect(
      filterArmoryUsagesForAssociation(usages, {
        associationStrength: "decision_point",
        decisionPointId: "dp-2",
      })
    ).toEqual([usages[1]]);

    expect(
      filterArmoryUsagesForAssociation(usages, {
        associationStrength: "encounter",
        encounterReference: "enc-1",
      })
    ).toEqual([usages[0]]);

    expect(() =>
      filterArmoryUsagesForAssociation(usages, {
        associationStrength: "decision_point",
      })
    ).toThrow("decisionPointId is required");

    expect(
      filterArmoryUsagesForAssociation(usages, {
        associationStrength: "mission_window_legacy",
      })
    ).toEqual(usages);
  });
});
